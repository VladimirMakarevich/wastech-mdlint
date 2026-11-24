import type { IncomingMessage, ServerResponse } from "node:http";

import type { LintMessage } from "@wastech-mdlint/core";

import {
  candidateText,
  configApi,
  parseChangeRequest,
  previewCandidate,
  readConfigFile,
  renderConfigArticle,
  saveCandidate,
  validateCandidate,
  writeBlockedReason,
  type ChangeRequest,
  type ConfigFile,
} from "./config-editor.js";
import { sendHtml, sendJson } from "./http-send.js";
import { openCommand } from "./open-file.js";
import type { ViewerContext } from "./viewer-context.js";

// The config page and the three things it asks of the server: a preview of what a changed config
// would report, a save, and showing the file in the system's own program.

export class ConfigRoutes {
  // Saves run one at a time: between checking that the file is the version the page edited and
  // replacing it, a second save must not slip in.
  private configWrites = Promise.resolve();

  constructor(private readonly ctx: ViewerContext) {}

  async sendConfigPage(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    sendHtml(
      response,
      200,
      await this.ctx.page({
        title: "Linter config",
        section: "config",
        article: await renderConfigArticle(this.ctx.corpus, {
          allowWrites: this.ctx.allowConfigWrites,
          showAbsolutePath: this.ctx.showAbsolutePaths,
          canOpen: this.ctx.openRefused === undefined,
          editor: await configApi(this.ctx.corpus, this.ctx.allowConfigWrites),
        }),
        changeToken: this.ctx.changeToken,
        scriptFirst: true,
      }),
      request.method === "HEAD",
    );
  }

  async sendConfigData(response: ServerResponse): Promise<void> {
    sendJson(
      response,
      await configApi(this.ctx.corpus, this.ctx.allowConfigWrites),
    );
  }

  // A preview or a save, once its body has passed the checks every change request passes.
  async changeConfig(
    response: ServerResponse,
    target: string,
    body: unknown,
  ): Promise<void> {
    const parsed = parseChangeRequest(body);
    if (!parsed.ok) {
      sendJson(response, { status: "refused", error: parsed.message }, 400);
      return;
    }
    if (target === "/api/config/save") {
      const run = this.configWrites.then(() =>
        this.saveChange(response, parsed.request),
      );
      this.configWrites = run.catch(() => undefined);
      await run;
      return;
    }
    await this.previewChange(response, parsed.request);
  }

  // Shows the config file in the file manager or opens it in its default application, on the
  // machine running the viewer. The file is always the one the corpus was loaded from; the request
  // only picks which of the two, so it can name no other file and pass no argument of its own.
  async openConfig(response: ServerResponse, body: unknown): Promise<void> {
    const action = (body as { action?: unknown } | null)?.action;
    if (action !== "reveal" && action !== "open") {
      sendJson(
        response,
        {
          status: "refused",
          error: 'The action must be "reveal" or "open".',
        },
        400,
      );
      return;
    }
    if (this.ctx.openRefused !== undefined) {
      sendJson(
        response,
        { status: "refused", error: this.ctx.openRefused },
        403,
      );
      return;
    }
    const file = await readConfigFile(this.ctx.corpus);
    if (file === undefined) {
      sendJson(
        response,
        {
          status: "refused",
          error: "This repository has no config file to open.",
        },
        409,
      );
      return;
    }
    const command = openCommand(process.platform, action, file.absolutePath);
    if (command === undefined) {
      sendJson(
        response,
        {
          status: "refused",
          error:
            "The config file's path cannot be passed to the system safely.",
        },
        409,
      );
      return;
    }
    try {
      await this.ctx.launch(command);
    } catch (error) {
      sendJson(
        response,
        {
          status: "failed",
          error: `Could not start ${command.command}: ${(error as Error).message}`,
        },
        500,
      );
      return;
    }
    sendJson(response, { status: "opened", action });
  }

  // The file a change applies to, or `undefined` after answering why there is none to apply it to.
  private async changeBase(
    response: ServerResponse,
    base: string,
  ): Promise<ConfigFile | undefined> {
    const file = await readConfigFile(this.ctx.corpus);
    if (file === undefined) {
      sendJson(
        response,
        {
          status: "refused",
          error: "This repository has no config file to change.",
        },
        409,
      );
      return undefined;
    }
    if (file.hash !== base) {
      sendJson(
        response,
        {
          status: "conflict",
          error:
            "The config changed on disk since this page read it. Reload the page to edit the new version.",
        },
        409,
      );
      return undefined;
    }
    return file;
  }

  private async previewChange(
    response: ServerResponse,
    change: ChangeRequest,
  ): Promise<void> {
    const file = await this.changeBase(response, change.base);
    if (file === undefined) {
      return;
    }
    const candidate = candidateText(file, change);
    if (!candidate.ok) {
      sendJson(response, { status: "invalid", errors: candidate.errors }, 422);
      return;
    }
    const validated = validateCandidate(this.ctx.corpus, file, candidate.text);
    if (!validated.ok) {
      sendJson(
        response,
        { status: "invalid", errors: validated.errors, text: candidate.text },
        422,
      );
      return;
    }
    sendJson(
      response,
      await previewCandidate({
        corpus: this.ctx.corpus,
        current: this.currentFindings(),
        candidate: validated.loaded,
        text: candidate.text,
      }),
    );
  }

  // What the config reports now: the background lint's result when it is in, else a lint run here.
  private currentFindings(): LintMessage[] {
    const byFile = this.ctx.diagnostics.messagesByFile;
    return byFile === undefined
      ? this.ctx.corpus.lint().messages
      : [...byFile.values()].flat();
  }

  private async saveChange(
    response: ServerResponse,
    change: ChangeRequest,
  ): Promise<void> {
    const blocked = await writeBlockedReason(
      this.ctx.corpus,
      this.ctx.allowConfigWrites,
    );
    if (blocked !== undefined) {
      sendJson(response, { status: "refused", error: blocked }, 403);
      return;
    }
    if (change.text === undefined || change.edits !== undefined) {
      // A save writes exactly the text the reader previewed, never a result computed afresh here.
      sendJson(
        response,
        {
          status: "refused",
          error: "A save carries the previewed text and no edits.",
        },
        400,
      );
      return;
    }
    const file = await this.changeBase(response, change.base);
    if (file === undefined) {
      return;
    }
    const validated = validateCandidate(this.ctx.corpus, file, change.text);
    if (!validated.ok) {
      sendJson(response, { status: "invalid", errors: validated.errors }, 422);
      return;
    }
    const outcome = await saveCandidate({ file, text: change.text });
    if (outcome.status === "failed") {
      sendJson(response, { status: "failed", error: outcome.message }, 500);
      return;
    }
    if (outcome.status === "conflict") {
      sendJson(response, { status: "conflict", error: outcome.message }, 409);
      return;
    }
    // The watcher sees the config change and reloads the corpus as it does for any edit; without
    // one nothing else would, and every page would go on showing the old config's findings.
    if (!this.ctx.watch) {
      await this.ctx.corpus.reload();
      this.ctx.renders.clear();
      this.ctx.changes?.invalidate();
      this.ctx.events.broadcast("change", { paths: [], structural: true });
      this.ctx.relint();
    }
    sendJson(response, outcome);
  }
}
