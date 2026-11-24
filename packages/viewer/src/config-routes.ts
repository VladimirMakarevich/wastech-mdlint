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

export function configRoutes(ctx: ViewerContext) {
  const { corpus } = ctx;
  // Saves run one at a time: between checking that the file is the version the page edited and
  // replacing it, a second save must not slip in.
  let configWrites = Promise.resolve();

  async function sendConfigPage(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    sendHtml(
      response,
      200,
      ctx.page({
        title: "Linter config",
        section: "config",
        article: await renderConfigArticle(corpus, {
          allowWrites: ctx.allowConfigWrites,
          showAbsolutePath: ctx.showAbsolutePaths,
          canOpen: ctx.openRefused === undefined,
        }),
        changeToken: ctx.changeToken,
      }),
      request.method === "HEAD",
    );
  }

  async function sendConfigData(response: ServerResponse): Promise<void> {
    sendJson(response, await configApi(corpus, ctx.allowConfigWrites));
  }

  // A preview or a save, once its body has passed the checks every change request passes.
  async function changeConfig(
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
      const run = configWrites.then(() => saveChange(response, parsed.request));
      configWrites = run.catch(() => undefined);
      await run;
      return;
    }
    await previewChange(response, parsed.request);
  }

  // Shows the config file in the file manager or opens it in its default application, on the
  // machine running the viewer. The file is always the one the corpus was loaded from; the request
  // only picks which of the two, so it can name no other file and pass no argument of its own.
  async function openConfig(
    response: ServerResponse,
    body: unknown,
  ): Promise<void> {
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
    if (ctx.openRefused !== undefined) {
      sendJson(response, { status: "refused", error: ctx.openRefused }, 403);
      return;
    }
    const file = await readConfigFile(corpus);
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
      await ctx.launch(command);
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
  async function changeBase(
    response: ServerResponse,
    base: string,
  ): Promise<ConfigFile | undefined> {
    const file = await readConfigFile(corpus);
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

  async function previewChange(
    response: ServerResponse,
    change: ChangeRequest,
  ): Promise<void> {
    const file = await changeBase(response, change.base);
    if (file === undefined) {
      return;
    }
    const candidate = candidateText(file, change);
    if (!candidate.ok) {
      sendJson(response, { status: "invalid", errors: candidate.errors }, 422);
      return;
    }
    const validated = validateCandidate(corpus, file, candidate.text);
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
        corpus,
        current: currentFindings(),
        candidate: validated.loaded,
        text: candidate.text,
      }),
    );
  }

  // What the config reports now: the background lint's result when it is in, else a lint run here.
  function currentFindings(): LintMessage[] {
    const byFile = ctx.diagnostics.messagesByFile;
    return byFile === undefined
      ? corpus.lint().messages
      : [...byFile.values()].flat();
  }

  async function saveChange(
    response: ServerResponse,
    change: ChangeRequest,
  ): Promise<void> {
    const blocked = await writeBlockedReason(corpus, ctx.allowConfigWrites);
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
    const file = await changeBase(response, change.base);
    if (file === undefined) {
      return;
    }
    const validated = validateCandidate(corpus, file, change.text);
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
    if (!ctx.watch) {
      await corpus.reload();
      ctx.renders.clear();
      ctx.changes?.invalidate();
      ctx.events.broadcast("change", { paths: [], structural: true });
      ctx.relint();
    }
    sendJson(response, outcome);
  }

  return { sendConfigPage, sendConfigData, changeConfig, openConfig };
}
