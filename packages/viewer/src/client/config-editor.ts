// The config page's editor. It builds a form from the config schema core generates — the one an
// editor validates the file against — and turns every change into an edit of the file's text, which
// the server applies with core's `editConfigText` (so comments survive) and checks with core's
// `parseConfiguration`. Nothing here decides whether a config is valid: the preview shows core's
// answer, and a save writes the exact text that was previewed.

import { copyText } from "./clipboard.js";
import { button, element, paragraph, section } from "./config-dom.js";
import { clearDraft, readDraft, storeDraft } from "./config-draft.js";
import { FieldRenderer } from "./config-fields.js";
import {
  clone,
  getAt,
  insertAt,
  removeAt,
  replayEdits,
  samePath,
  setAt,
} from "./config-json.js";
import { counts, invalidPreview, okPreview } from "./config-preview.js";
import { rulesList, type RuleListHost } from "./config-rules.js";
import type {
  ConfigApi,
  Edit,
  Json,
  JsonObject,
  JsonSchema,
  Path,
  Preview,
} from "./config-types.js";

/** The id of the data the editor is built from, as the server names it. */
export const CONFIG_DATA_ID = "viewer.config-data";

// Long enough for a burst of typing to become one preview request.
const PREVIEW_DELAY_MS = 400;

export function initConfigEditor(): void {
  const root = document.querySelector<HTMLElement>(".config-editor");
  const token = document.querySelector<HTMLMetaElement>(
    'meta[name="wastech-change-token"]',
  )?.content;
  // The page carries what the editor is built from (`CONFIG_DATA_ID` in the server's
  // `config-editor.ts`, the same data `/api/config` answers), so the form is built as the script
  // runs, before the page is first drawn, rather than once a request comes back — which pushed the
  // file below it down the page a frame or two after it was drawn.
  const data = document.getElementById(CONFIG_DATA_ID)?.textContent ?? "";
  if (root === null || token === undefined || data === "") {
    return;
  }
  const api = JSON.parse(data) as ConfigApi;
  if (api.file !== null) {
    new ConfigEditor(root, api, api.file, token).start();
  }
}

class ConfigEditor {
  private mode: "form" | "text";
  // The text the edits apply to: the file's text, until the reader changes the text itself.
  private text: string;
  private edits: Edit[] = [];
  // The config as edited so far, for the form to show; `null` while the text does not load.
  private model: JsonObject | null;
  private ruleIds: (string | null)[];
  private preview: Preview | undefined;
  private previewTimer: number | undefined;
  private previewController: AbortController | undefined;
  private previewRun: Promise<void> = Promise.resolve();
  private openRule: number | undefined;
  // Set while a restored draft's form edits wait to be folded into its changed text. Only the server
  // can apply edits to text, so until its preview does, the textarea holds the text without them and
  // stays read-only: typing into it starts over from that text and would drop the edits.
  private foldingDraft = false;

  private readonly formView = element("div", "config-form-view");
  private readonly textView = element("div", "config-text-view");
  private readonly textarea = document.createElement("textarea");
  private readonly modeButtons = {
    form: button("Form", "config-mode segment"),
    text: button("Text", "config-mode segment"),
  };
  private readonly status = element("p", "config-status");
  private readonly previewBody = element("div", "config-preview-body");
  private readonly actions = element("div", "config-actions");
  // Pinned to the bottom of the window while there is a change: the form is long, and Save at the
  // end of it, below the preview, is a button a reader who changed one severity never scrolls to.
  private readonly bar = element("div", "config-bar");
  private readonly barText = element("p", "config-bar-text");
  // The form's inputs read the model and hand every change back as an edit.
  private readonly fields = new FieldRenderer({
    get: (path) => getAt(this.model, path),
    set: (path, value) => {
      this.set(path, value);
    },
    remove: (path) => {
      this.remove(path);
    },
    insert: (path, value) => {
      this.insert(path, value);
    },
  });

  constructor(
    private readonly root: HTMLElement,
    private readonly api: ConfigApi,
    private readonly file: { path: string; text: string; hash: string },
    private readonly token: string,
  ) {
    this.text = file.text;
    this.model = api.config === null ? null : clone(api.config);
    this.ruleIds = [...api.ruleIds];
    // A file that does not load cannot be shown as a form; its text, with core's reason, can.
    this.mode = this.model === null ? "text" : "form";
  }

  start(): void {
    this.restoreDraft();
    this.root.hidden = false;
    this.textarea.className = "config-textarea";
    this.textarea.spellcheck = false;
    this.textarea.setAttribute("aria-label", "Config file text");
    this.textarea.readOnly = this.foldingDraft;
    this.textarea.addEventListener("input", () => {
      this.text = this.textarea.value;
      this.edits = [];
      this.model = null;
      this.changed();
    });
    this.textView.append(this.textarea);

    const modes = element("div", "config-modes segmented");
    modes.setAttribute("role", "group");
    modes.setAttribute("aria-label", "Edit as");
    modes.append(this.modeButtons.form, this.modeButtons.text);
    this.modeButtons.form.addEventListener(
      "click",
      () => void this.switchTo("form"),
    );
    this.modeButtons.text.addEventListener(
      "click",
      () => void this.switchTo("text"),
    );
    const toolbar = element("div", "config-toolbar");
    toolbar.append(modes, this.status);
    if (this.foldingDraft) {
      this.status.textContent = "Restoring your unsaved change…";
    }

    const previewSection = element("section", "config-preview");
    previewSection.id = "config-preview";
    previewSection.setAttribute("aria-label", "Preview");
    const heading = element("h2");
    heading.textContent = "Preview";
    previewSection.append(heading, this.previewBody);

    this.bar.setAttribute("role", "region");
    this.bar.setAttribute("aria-label", "Unsaved change");
    this.barText.setAttribute("aria-live", "polite");
    this.bar.hidden = true;
    this.bar.append(this.barText, this.actions);

    this.root.replaceChildren(
      toolbar,
      this.formView,
      this.textView,
      this.bar,
      previewSection,
    );
    this.render();
    if (this.hasChanges()) {
      this.schedulePreview(0);
    } else if (this.api.errors.length > 0) {
      this.preview = { status: "invalid", errors: this.api.errors };
      this.renderPreview();
    } else {
      this.renderPreview();
    }
  }

  private hasChanges(): boolean {
    return this.text !== this.file.text || this.edits.length > 0;
  }

  private render(): void {
    this.modeButtons.form.setAttribute(
      "aria-pressed",
      String(this.mode === "form"),
    );
    this.modeButtons.text.setAttribute(
      "aria-pressed",
      String(this.mode === "text"),
    );
    this.formView.hidden = this.mode !== "form";
    this.textView.hidden = this.mode !== "text";
    if (this.mode === "text") {
      this.textarea.value = this.text;
      this.formView.replaceChildren();
    } else {
      this.renderForm();
    }
  }

  private async switchTo(mode: "form" | "text"): Promise<void> {
    if (mode === this.mode) {
      return;
    }
    if (this.hasChanges()) {
      // The other view needs this one's result: the text the edits produce, or the config the text
      // loads as. Both come from the server, so wait for the preview that is on its way.
      window.clearTimeout(this.previewTimer);
      this.previewRun = this.runPreview();
      await this.previewRun;
    }
    const preview = this.preview;
    if (mode === "text") {
      if (this.edits.length > 0) {
        if (
          preview?.status !== "ok" &&
          !(
            preview?.status === "invalid" &&
            preview.text !== undefined &&
            preview.text !== ""
          )
        ) {
          this.status.textContent =
            "These changes cannot be turned into text yet; see the preview below.";
          return;
        }
        this.text = preview.text!;
        this.edits = [];
      }
    } else if (this.model === null) {
      if (preview?.status !== "ok") {
        this.status.textContent =
          "The form can show this config once it loads; fix what the preview names first.";
        return;
      }
      this.model = clone(preview.config);
      this.ruleIds = [...preview.ruleIds];
    }
    this.status.textContent = "";
    this.mode = mode;
    this.render();
    this.saveDraft();
  }

  // --- The form ------------------------------------------------------------------------------

  private renderForm(): void {
    const model = this.model!;
    const schema = this.api.schema.properties ?? {};
    const files = section("Files", "Which Markdown files are documents.");
    for (const key of ["include", "exclude", "respectGitignore"]) {
      files.append(this.topField(schema[key] ?? {}, key));
    }
    const rules = section(
      "Rules",
      "The checks this config runs, in the order it lists them.",
    );
    rules.append(
      rulesList(
        this.ruleListHost(),
        Array.isArray(model.rules) ? model.rules : [],
      ),
    );
    const settings = section(
      "Settings",
      "How root-relative links resolve and which ids link documents.",
    );
    settings.append(this.topField(schema.settings ?? {}, "settings"));
    const compile = section("Compile", "What wastech-mdlint compile writes.");
    compile.append(this.topField(schema.compile ?? {}, "compile"));
    this.formView.replaceChildren(files, rules, settings, compile);
  }

  private topField(schema: JsonSchema, key: string): HTMLElement {
    return this.fields.field({
      schema,
      path: [key],
      label: key,
      required: false,
    });
  }

  // The rule cards' view of the editor. The rule ids and the open card live here, because a switch
  // between the views or a restored draft replaces them, and the cards are drawn again after either.
  private ruleListHost(): RuleListHost {
    return {
      api: this.api,
      fields: this.fields,
      ruleId: (index) => this.ruleIds[index] ?? null,
      configuredIds: () =>
        new Set(this.ruleIds.filter((id): id is string => id !== null)),
      isOpen: (index) => this.openRule === index,
      current: (path) => getAt(this.model, path),
      addRule: (entry, id) => {
        this.addRule(entry, id);
      },
      removeRule: (index) => {
        this.removeRule(index);
      },
    };
  }

  // A new rule goes at the end of the list, or starts the list, and its card opens.
  private addRule(entry: JsonObject, id: string | null): void {
    const rules = this.model?.rules;
    const length = Array.isArray(rules) ? rules.length : 0;
    if (Array.isArray(rules)) {
      this.insert(["rules", length], entry);
    } else {
      this.set(["rules"], [entry]);
    }
    this.ruleIds.push(id);
    this.openRule = length;
    this.renderForm();
  }

  private removeRule(index: number): void {
    this.remove(["rules", index]);
    this.ruleIds.splice(index, 1);
    this.openRule = undefined;
    this.renderForm();
  }

  // --- Edits ---------------------------------------------------------------------------------

  private set(path: Path, value: Json): void {
    this.model = setAt(this.model ?? {}, path, clone(value));
    const last = this.edits.at(-1);
    // Typing into one field is one change, not one per keystroke.
    if (last?.op === "set" && samePath(last.path, path)) {
      last.value = clone(value);
    } else {
      this.edits.push({ op: "set", path: [...path], value: clone(value) });
    }
    this.changed();
  }

  private remove(path: Path): void {
    if (getAt(this.model, path) === undefined) {
      return;
    }
    removeAt(this.model!, path);
    this.edits.push({ op: "remove", path: [...path] });
    this.changed();
  }

  private insert(path: Path, value: Json): void {
    insertAt(this.model!, path, clone(value));
    this.edits.push({ op: "insert", path: [...path], value: clone(value) });
    this.changed();
  }

  private changed(): void {
    this.saveDraft();
    this.schedulePreview(PREVIEW_DELAY_MS);
  }

  // --- Preview and save ----------------------------------------------------------------------

  private schedulePreview(delay: number): void {
    window.clearTimeout(this.previewTimer);
    // A preview still on its way describes the config before this change. Let through, it would draw
    // that older result — and a Save button carrying its text — until the new one arrives.
    this.previewController?.abort();
    this.previewBody.replaceChildren(paragraph("Checking the change…"));
    this.actions.replaceChildren();
    this.showBar("Checking the change…");
    this.previewTimer = window.setTimeout(() => {
      this.previewRun = this.runPreview();
    }, delay);
  }

  private async runPreview(): Promise<void> {
    this.previewController?.abort();
    if (!this.hasChanges()) {
      this.preview = undefined;
      this.renderPreview();
      return;
    }
    const controller = new AbortController();
    this.previewController = controller;
    const body: Record<string, unknown> = { base: this.file.hash };
    if (this.text !== this.file.text) {
      body.text = this.text;
    }
    if (this.edits.length > 0) {
      body.edits = this.edits;
    }
    let preview: Preview;
    try {
      const response = await this.post(
        "/api/config/preview",
        body,
        controller.signal,
      );
      preview = (await response.json()) as Preview;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return;
      }
      preview = {
        status: "failed",
        error: "The viewer did not answer; it may be restarting.",
      };
    }
    // A newer change has started its own preview since; this answer is about an older config.
    if (controller !== this.previewController) {
      return;
    }
    this.preview = preview;
    if (this.foldingDraft) {
      this.foldDraft();
    }
    this.renderPreview();
  }

  // Once the server has applied a restored draft's form edits to its text, the text it answers with
  // replaces both, so the textarea shows the whole change and can be edited again. Edits it could not
  // apply stay, with the preview saying why.
  private foldDraft(): void {
    const preview = this.preview;
    const text =
      preview?.status === "ok" || preview?.status === "invalid"
        ? preview.text
        : undefined;
    if (text !== undefined) {
      this.text = text;
      this.edits = [];
      if (this.mode === "text") {
        this.textarea.value = text;
      }
      this.saveDraft();
    }
    this.foldingDraft = false;
    this.textarea.readOnly = false;
    this.status.textContent = "";
  }

  private post(
    url: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wastech-Viewer-Token": this.token,
      },
      body: JSON.stringify(body),
      signal,
    });
  }

  private renderPreview(): void {
    const preview = this.preview;
    this.actions.replaceChildren();
    if (preview === undefined || !this.hasChanges()) {
      this.previewBody.replaceChildren(
        paragraph(
          "No changes yet. Change a value and this shows what the linter would report with it.",
        ),
      );
      this.showBar(undefined);
      return;
    }
    if (preview.status === "invalid") {
      this.previewBody.replaceChildren(...invalidPreview(preview.errors));
      // The draft outlives a reload, so a change that does not load must be one the reader can drop.
      this.actions.append(this.discardButton());
      this.showBar("The linter would not load this config.", true);
      return;
    }
    if (preview.status !== "ok") {
      this.previewBody.replaceChildren(
        paragraph(preview.error, "config-invalid"),
      );
      this.showBar(preview.error);
      this.actions.append(
        preview.status === "conflict"
          ? this.discardButton("Reload the page")
          : this.discardButton(),
      );
      return;
    }
    this.previewBody.replaceChildren(...okPreview(preview, this.file.path));
    this.showBar(
      `With this change: ${counts(preview.findings.after)} — ${preview.addedCount} new, ${preview.removedCount} gone.`,
      true,
    );
    this.renderActions(preview.text);
  }

  // `undefined` hides the bar: with nothing changed there is nothing to save or drop.
  private showBar(text: string | undefined, linkToPreview = false): void {
    this.bar.hidden = text === undefined;
    if (text === undefined) {
      return;
    }
    const content: (string | Node)[] = [text];
    if (linkToPreview) {
      const link = document.createElement("a");
      link.href = "#config-preview";
      link.textContent = "See the preview";
      content.push(" ", link);
    }
    this.barText.replaceChildren(...content);
  }

  private renderActions(text: string): void {
    const copy = button("Copy");
    copy.addEventListener("click", () => {
      void copyText(text).then(
        (copied) => (copy.textContent = copied ? "Copied" : "Copy failed"),
      );
    });
    const download = button("Download");
    download.addEventListener("click", () => {
      const url = URL.createObjectURL(
        new Blob([text], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download =
        this.file.path.split("/").pop() ?? "wastech-mdlint.config.json";
      link.click();
      URL.revokeObjectURL(url);
    });
    this.actions.append(copy, download);
    if (this.api.writeBlocked === null) {
      const save = button("Save", "config-primary");
      save.addEventListener("click", () => void this.save(text, save));
      this.actions.append(save);
    }
    this.actions.append(this.discardButton());
    if (this.api.writeBlocked !== null) {
      this.actions.append(paragraph(this.api.writeBlocked, "config-save-off"));
    }
  }

  // Starts over from the file on disk: the draft is dropped and the page loaded again.
  private discardButton(label = "Discard changes"): HTMLButtonElement {
    const discard = button(label);
    discard.addEventListener("click", () => {
      clearDraft();
      location.reload();
    });
    return discard;
  }

  private async save(text: string, control: HTMLButtonElement): Promise<void> {
    control.disabled = true;
    let result: { status: string; error?: string; errors?: string[] };
    try {
      result = (await (
        await this.post("/api/config/save", { base: this.file.hash, text })
      ).json()) as typeof result;
    } catch {
      result = {
        status: "failed",
        error: "The viewer did not answer; nothing is known to be saved.",
      };
    }
    if (result.status === "saved") {
      clearDraft();
      // The server reloads the corpus for the new config and tells every page, this one included,
      // to reload; until then the reader knows the write happened.
      const saved = `Saved to ${this.file.path}. The viewer is reloading the corpus with it.`;
      this.previewBody.replaceChildren(paragraph(saved, "config-saved"));
      this.actions.replaceChildren();
      this.showBar(saved);
      return;
    }
    control.disabled = false;
    this.preview =
      result.status === "invalid"
        ? { status: "invalid", errors: result.errors ?? [] }
        : {
            status: result.status === "conflict" ? "conflict" : "failed",
            error: result.error ?? "The save failed.",
          };
    this.renderPreview();
  }

  // --- Draft ---------------------------------------------------------------------------------

  private saveDraft(): void {
    storeDraft(
      this.hasChanges()
        ? {
            base: this.file.hash,
            text: this.text,
            edits: this.edits,
            mode: this.mode,
          }
        : undefined,
    );
  }

  private restoreDraft(): void {
    const draft = readDraft();
    if (draft?.base !== this.file.hash) {
      return;
    }
    this.text = draft.text;
    this.edits = draft.edits;
    if (this.text !== this.file.text) {
      // The form's model would have to be rebuilt from text, which only the server can parse. Edits
      // the form made on top of that text are kept and folded into it by the first preview.
      this.model = null;
      this.mode = "text";
      this.foldingDraft = this.edits.length > 0;
      return;
    }
    this.model = replayEdits(this.model, this.edits);
    this.ruleIds = (
      Array.isArray(this.model?.rules) ? this.model.rules : []
    ).map((entry) => this.resolveRuleId(entry));
    // Edits are restored into the form, whichever view they were made in: turning them into text is
    // the server's job, and the form can switch to text once the preview has done it.
    this.mode = this.model === null ? "text" : "form";
  }

  // An entry as written may name a rule by its alias or in another case; the form shows it by id.
  private resolveRuleId(entry: Json): string | null {
    const name =
      typeof entry === "object" && entry !== null && !Array.isArray(entry)
        ? entry.rule
        : undefined;
    if (typeof name !== "string" || name === "custom") {
      return null;
    }
    const rule = this.api.rules.find(
      (candidate) =>
        candidate.id.toUpperCase() === name.toUpperCase() ||
        candidate.alias === name.toLowerCase(),
    );
    return rule?.id ?? null;
  }
}
