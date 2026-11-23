// The config page's editor. It builds a form from the config schema core generates — the one an
// editor validates the file against — and turns every change into an edit of the file's text, which
// the server applies with core's `editConfigText` (so comments survive) and checks with core's
// `parseConfiguration`. Nothing here decides whether a config is valid: the preview shows core's
// answer, and a save writes the exact text that was previewed.

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  oneOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  description?: string;
  default?: unknown;
  minimum?: number;
  exclusiveMinimum?: number;
  pattern?: string;
};

type RuleInfo = {
  id: string;
  alias: string;
  category: string;
  description: string;
  defaultSeverity: string;
  fixable: boolean;
  docsUrl?: string;
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
type Path = (string | number)[];

type ConfigApi = {
  file: { path: string; text: string; hash: string } | null;
  config: JsonObject | null;
  ruleIds: (string | null)[];
  errors: string[];
  writeBlocked: string | null;
  schema: JsonSchema;
  rules: RuleInfo[];
};

type Edit = { op: "set" | "remove" | "insert"; path: Path; value?: Json };

type Finding = {
  filePath: string;
  line: number;
  ruleId: string;
  severity: string;
  message: string;
};

type Preview =
  | {
      status: "ok";
      text: string;
      config: JsonObject;
      ruleIds: (string | null)[];
      documents: { before: number; after: number };
      findings: {
        before: { errors: number; warnings: number };
        after: { errors: number; warnings: number };
      };
      byRule: { ruleId: string; before: number; after: number }[];
      added: Finding[];
      removed: Finding[];
      addedCount: number;
      removedCount: number;
    }
  | { status: "invalid"; errors: string[]; text?: string }
  | { status: "conflict" | "refused" | "failed"; error: string };

// Unsaved work, kept across a reload — live reload refreshes the page whenever a document is added
// or removed, and losing a half-made config change to that would be a trap. It is restored only
// onto the same version of the file it was made to.
const DRAFT_KEY = "wastech-mdlint-viewer:config-draft";
// Long enough for a burst of typing to become one preview request.
const PREVIEW_DELAY_MS = 400;

export function initConfigEditor(): void {
  const root = document.querySelector<HTMLElement>(".config-editor");
  const token = document.querySelector<HTMLMetaElement>(
    'meta[name="wastech-change-token"]',
  )?.content;
  if (root === null || token === undefined) {
    return;
  }
  void fetch("/api/config")
    .then((response) => response.json() as Promise<ConfigApi>)
    .then((api) => {
      if (api.file !== null) {
        new ConfigEditor(root, api, api.file, token).start();
      }
    })
    .catch(() => {
      // The server is restarting; live reload brings the page back with a fresh copy.
    });
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

  private readonly formView = element("div", "config-form-view");
  private readonly textView = element("div", "config-text-view");
  private readonly textarea = document.createElement("textarea");
  private readonly modeButtons = {
    form: button("Form", "config-mode"),
    text: button("Text", "config-mode"),
  };
  private readonly status = element("p", "config-status");
  private readonly previewBody = element("div", "config-preview-body");
  private readonly actions = element("div", "config-actions");

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
    this.textarea.addEventListener("input", () => {
      this.text = this.textarea.value;
      this.edits = [];
      this.model = null;
      this.changed();
    });
    this.textView.append(this.textarea);

    const modes = element("div", "config-modes");
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

    const previewSection = element("section", "config-preview");
    previewSection.setAttribute("aria-label", "Preview");
    previewSection.setAttribute("aria-live", "polite");
    const heading = element("h2");
    heading.textContent = "Preview";
    previewSection.append(heading, this.previewBody, this.actions);

    this.root.replaceChildren(
      toolbar,
      this.formView,
      this.textView,
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
          !(preview?.status === "invalid" && preview.text)
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
      files.append(this.field(schema[key] ?? {}, [key], key, false));
    }
    const rules = section(
      "Rules",
      "The checks this config runs, in the order it lists them.",
    );
    rules.append(this.rulesList(model));
    const settings = section(
      "Settings",
      "How root-relative links resolve and which ids link documents.",
    );
    settings.append(
      this.field(schema.settings ?? {}, ["settings"], "settings", false),
    );
    const compile = section("Compile", "What wastech-mdlint compile writes.");
    compile.append(
      this.field(schema.compile ?? {}, ["compile"], "compile", false),
    );
    this.formView.replaceChildren(files, rules, settings, compile);
  }

  private rulesList(model: JsonObject): HTMLElement {
    const container = element("div", "config-rule-list");
    const entries = Array.isArray(model.rules) ? model.rules : [];
    entries.forEach((entry, index) => {
      container.append(this.ruleCard(entry as JsonObject, index));
    });

    const configured = new Set(
      this.ruleIds.filter((id): id is string => id !== null),
    );
    const picker = document.createElement("select");
    picker.setAttribute("aria-label", "Rule to add");
    const categories = new Map<string, RuleInfo[]>();
    for (const rule of this.api.rules) {
      if (!configured.has(rule.id)) {
        categories.set(rule.category, [
          ...(categories.get(rule.category) ?? []),
          rule,
        ]);
      }
    }
    for (const [category, rules] of categories) {
      const group = document.createElement("optgroup");
      group.label = category;
      for (const rule of rules) {
        const option = new Option(`${rule.id} — ${rule.description}`, rule.id);
        option.title = rule.description;
        group.append(option);
      }
      picker.append(group);
    }
    const custom = document.createElement("optgroup");
    custom.label = "Custom";
    custom.append(new Option("A declarative custom rule", "custom"));
    picker.append(custom);

    const add = button("Add rule");
    add.addEventListener("click", () => {
      const id = picker.value;
      const entry: JsonObject =
        id === "custom"
          ? {
              rule: "custom",
              id: "",
              options: { assert: { kind: this.firstAssertKind() } },
            }
          : { rule: id };
      const length = entries.length;
      if (Array.isArray(model.rules)) {
        this.insert(["rules", length], entry);
      } else {
        this.set(["rules"], [entry]);
      }
      this.ruleIds.push(id === "custom" ? null : id);
      this.openRule = length;
      this.renderForm();
    });
    const adder = element("div", "config-rule-add");
    adder.append(picker, add);
    container.append(adder);
    return container;
  }

  private ruleCard(entry: JsonObject, index: number): HTMLElement {
    const id = this.ruleIds[index] ?? null;
    const isCustom = entry.rule === "custom";
    const info =
      id === null ? undefined : this.api.rules.find((rule) => rule.id === id);
    const branch = isCustom
      ? this.customBranch()
      : this.builtinBranch(id ?? "");
    const path: Path = ["rules", index];

    const card = document.createElement("details");
    card.className = "config-rule";
    card.open = this.openRule === index;
    const summary = document.createElement("summary");
    const name = element("code", "config-rule-id");
    name.textContent = isCustom
      ? String(entry.id || "custom rule")
      : (id ?? String(entry.rule));
    const description = element("span", "config-rule-description");
    description.textContent = isCustom
      ? String(entry.description ?? "Custom rule")
      : (info?.description ?? "");
    const severity = element("span", "config-rule-severity");
    severity.textContent = String(
      entry.severity ?? info?.defaultSeverity ?? "",
    );
    summary.append(name, description, severity);
    card.append(summary);

    const body = element("div", "config-rule-body");
    const severitySchema: JsonSchema = {
      type: "string",
      enum: ["error", "warning", "off"],
    };
    body.append(
      this.field(severitySchema, [...path, "severity"], "severity", false, {
        unsetLabel: `default (${info?.defaultSeverity ?? "per finding"})`,
      }),
    );
    if (isCustom) {
      const properties = branch?.properties ?? {};
      body.append(
        this.field({ type: "string" }, [...path, "id"], "id", true),
        this.field(
          { type: "string" },
          [...path, "description"],
          "description",
          false,
        ),
        this.field(
          properties.target ?? { type: "string" },
          [...path, "target"],
          "target",
          false,
        ),
      );
    }
    const optionsSchema = branch?.properties?.options;
    if (optionsSchema !== undefined) {
      body.append(
        this.field(optionsSchema, [...path, "options"], "options", isCustom),
      );
    }
    const footer = element("div", "config-rule-footer");
    if (info?.docsUrl !== undefined) {
      const docs = document.createElement("a");
      docs.href = info.docsUrl;
      docs.target = "_blank";
      docs.rel = "noopener noreferrer";
      docs.textContent = "Rule documentation";
      footer.append(docs);
    }
    const remove = button("Remove rule", "config-danger");
    remove.addEventListener("click", () => {
      this.remove(path);
      this.ruleIds.splice(index, 1);
      this.openRule = undefined;
      this.renderForm();
    });
    footer.append(remove);
    body.append(footer);
    card.append(body);
    return card;
  }

  private builtinBranch(id: string): JsonSchema | undefined {
    return this.ruleBranches().find((branch) =>
      branch.properties?.rule?.enum?.includes(id),
    );
  }

  // The generic custom branch: `const: "custom"` with an id *pattern*. A project-local schema would
  // add one branch per known custom id, but the package schema the server sends has only this one.
  private customBranch(): JsonSchema | undefined {
    return this.ruleBranches().find(
      (branch) =>
        branch.properties?.rule?.const === "custom" &&
        branch.properties.id?.pattern !== undefined,
    );
  }

  private ruleBranches(): JsonSchema[] {
    return this.api.schema.properties?.rules?.items?.oneOf ?? [];
  }

  private firstAssertKind(): string {
    const assert = this.customBranch()?.properties?.options?.properties?.assert;
    return String(assert?.oneOf?.[0]?.properties?.kind?.const ?? "");
  }

  /** One input, or a group of them, for the value the schema describes at `path`. */
  private field(
    schema: JsonSchema,
    path: Path,
    label: string,
    required: boolean,
    options: { unsetLabel?: string; inList?: boolean } = {},
  ): HTMLElement {
    const value = getAt(this.model, path);
    if (
      schema.oneOf !== undefined &&
      schema.oneOf.every(
        (branch) => branch.properties?.kind?.const !== undefined,
      )
    ) {
      return this.kindField(schema.oneOf, path, label, required);
    }
    if (schema.type === "object" && schema.properties !== undefined) {
      const group = element("fieldset", "config-group");
      const legend = element("legend");
      legend.textContent = labelText(label, required);
      group.append(legend);
      if (schema.description !== undefined) {
        group.append(hint(schema.description));
      }
      const requiredKeys = new Set(schema.required ?? []);
      for (const [key, child] of Object.entries(schema.properties)) {
        group.append(
          this.field(child, [...path, key], key, requiredKeys.has(key)),
        );
      }
      return group;
    }
    if (schema.type === "array" && schema.items !== undefined) {
      const items = schema.items;
      if (
        isPrimitive(items) ||
        (items.type === "object" && items.properties !== undefined)
      ) {
        return this.listField(schema, items, path, label, required);
      }
      return this.jsonField(schema, path, label, required);
    }
    if (schema.enum !== undefined || schema.type === "boolean") {
      const choices = schema.enum ?? [true, false];
      const select = document.createElement("select");
      select.append(
        new Option(
          options.unsetLabel ??
            (schema.default === undefined
              ? "—"
              : `default (${String(schema.default)})`),
          "",
        ),
      );
      for (const choice of choices) {
        select.append(new Option(String(choice), JSON.stringify(choice)));
      }
      select.value = value === undefined ? "" : JSON.stringify(value);
      select.addEventListener("change", () => {
        if (select.value === "") {
          this.remove(path);
        } else {
          this.set(path, JSON.parse(select.value) as Json);
        }
      });
      return labelled(label, required, select, schema.description);
    }
    if (
      schema.type === "string" ||
      schema.type === "number" ||
      schema.type === "integer"
    ) {
      const input = document.createElement("input");
      const numeric = schema.type !== "string";
      input.type = numeric ? "number" : "text";
      if (numeric) {
        input.step = schema.type === "integer" ? "1" : "any";
        const min = schema.minimum ?? schema.exclusiveMinimum;
        if (min !== undefined) {
          input.min = String(min);
        }
      } else {
        input.spellcheck = false;
        if (schema.pattern !== undefined) {
          input.title = `Pattern: ${schema.pattern}`;
        }
      }
      input.value = value === undefined || value === null ? "" : String(value);
      input.addEventListener("input", () => {
        if (input.value === "" && !options.inList) {
          this.remove(path);
          return;
        }
        if (numeric) {
          const number = Number(input.value);
          if (input.value !== "" && Number.isFinite(number)) {
            this.set(path, number);
          }
        } else {
          this.set(path, input.value);
        }
      });
      return options.inList === true
        ? input
        : labelled(label, required, input, schema.description);
    }
    return this.jsonField(schema, path, label, required);
  }

  // A union told apart by its `kind`, such as a custom rule's assertion: pick the kind, then fill in
  // that kind's fields. Picking another kind starts the value over, since the fields differ.
  private kindField(
    branches: JsonSchema[],
    path: Path,
    label: string,
    required: boolean,
  ): HTMLElement {
    const group = element("fieldset", "config-group");
    const legend = element("legend");
    legend.textContent = labelText(label, required);
    const current = getAt(this.model, path) as JsonObject | undefined;
    const select = document.createElement("select");
    for (const branch of branches) {
      const kind = String(branch.properties!.kind!.const);
      select.append(new Option(kind, kind));
    }
    select.value = String(current?.kind ?? "");
    const fields = element("div");
    const renderFields = () => {
      const branch = branches.find(
        (candidate) => candidate.properties!.kind!.const === select.value,
      );
      const requiredKeys = new Set(branch?.required ?? []);
      fields.replaceChildren(
        ...Object.entries(branch?.properties ?? {})
          .filter(([key]) => key !== "kind")
          .map(([key, child]) =>
            this.field(child, [...path, key], key, requiredKeys.has(key)),
          ),
      );
    };
    select.addEventListener("change", () => {
      this.set(path, { kind: select.value });
      renderFields();
    });
    group.append(legend, labelled("kind", true, select), fields);
    renderFields();
    return group;
  }

  private listField(
    schema: JsonSchema,
    items: JsonSchema,
    path: Path,
    label: string,
    required: boolean,
  ): HTMLElement {
    const group = element("fieldset", "config-group config-list");
    const legend = element("legend");
    legend.textContent = labelText(label, required);
    const list = element("div", "config-list-items");
    const add = button("Add", "config-add");
    const primitive = isPrimitive(items);

    const render = (focusLast = false) => {
      const values = getAt(this.model, path);
      const array = Array.isArray(values) ? values : [];
      list.replaceChildren(
        ...array.map((_, index) => {
          const row = element(
            "div",
            primitive ? "config-list-row" : "config-list-object",
          );
          const itemPath = [...path, index];
          const control = primitive
            ? this.field(items, itemPath, `${label} ${index + 1}`, true, {
                inList: true,
              })
            : this.field(items, itemPath, `${label} ${index + 1}`, true);
          if (
            control instanceof HTMLInputElement ||
            control instanceof HTMLSelectElement
          ) {
            control.setAttribute("aria-label", `${label} ${index + 1}`);
          }
          const remove = button("Remove", "config-remove");
          remove.setAttribute("aria-label", `Remove ${label} ${index + 1}`);
          remove.addEventListener("click", () => {
            this.remove(itemPath);
            render();
          });
          row.append(control, remove);
          return row;
        }),
      );
      if (focusLast) {
        list
          .querySelector<HTMLElement>(
            ".config-list-row:last-child input, .config-list-object:last-child input",
          )
          ?.focus();
      }
    };
    add.addEventListener("click", () => {
      const fresh: Json = primitive ? (items.type === "string" ? "" : 0) : {};
      const values = getAt(this.model, path);
      if (Array.isArray(values)) {
        this.insert([...path, values.length], fresh);
      } else {
        this.set(path, [fresh]);
      }
      render(true);
    });
    group.append(legend);
    if (schema.description !== undefined) {
      group.append(hint(schema.description));
    }
    group.append(list, add);
    render();
    return group;
  }

  // For a value the form has no inputs for — a map from names to lists, say — the value itself, as
  // JSON. It is applied when it parses, and core judges it like any other.
  private jsonField(
    schema: JsonSchema,
    path: Path,
    label: string,
    required: boolean,
  ): HTMLElement {
    const textarea = document.createElement("textarea");
    textarea.className = "config-json";
    textarea.spellcheck = false;
    const value = getAt(this.model, path);
    textarea.value = value === undefined ? "" : JSON.stringify(value, null, 2);
    const problem = element("span", "config-json-problem");
    textarea.addEventListener("change", () => {
      if (textarea.value.trim() === "") {
        problem.textContent = "";
        this.remove(path);
        return;
      }
      try {
        const parsed = JSON.parse(textarea.value) as Json;
        problem.textContent = "";
        this.set(path, parsed);
      } catch {
        problem.textContent = "Not valid JSON yet.";
      }
    });
    const wrapper = labelled(
      `${label} (JSON)`,
      required,
      textarea,
      schema.description,
    );
    wrapper.append(problem);
    return wrapper;
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
    this.previewBody.replaceChildren(paragraph("Checking the change…"));
    this.actions.replaceChildren();
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
    try {
      const response = await this.post(
        "/api/config/preview",
        body,
        controller.signal,
      );
      this.preview = (await response.json()) as Preview;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return;
      }
      this.preview = {
        status: "failed",
        error: "The viewer did not answer; it may be restarting.",
      };
    }
    this.renderPreview();
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
      return;
    }
    if (preview.status === "invalid") {
      const list = element("ul", "config-errors");
      for (const line of preview.errors) {
        const item = element("li");
        item.textContent = line.replace(/^- /, "");
        list.append(item);
      }
      this.previewBody.replaceChildren(
        paragraph("The linter would not load this config:", "config-invalid"),
        list,
      );
      // The draft outlives a reload, so a change that does not load must be one the reader can drop.
      this.actions.append(this.discardButton());
      return;
    }
    if (preview.status !== "ok") {
      this.previewBody.replaceChildren(
        paragraph(preview.error, "config-invalid"),
      );
      this.actions.append(
        preview.status === "conflict"
          ? this.discardButton("Reload the page")
          : this.discardButton(),
      );
      return;
    }

    const { before, after } = preview.findings;
    const parts: HTMLElement[] = [
      paragraph(
        `Now: ${counts(before)}. With this config: ${counts(after)} — ${preview.addedCount} new, ${preview.removedCount} gone.`,
        "config-summary",
      ),
    ];
    if (preview.documents.before !== preview.documents.after) {
      parts.push(
        paragraph(
          `The linted corpus would hold ${preview.documents.after} documents instead of ${preview.documents.before}.`,
        ),
      );
    }
    const changedRules = preview.byRule.filter(
      (rule) => rule.before !== rule.after,
    );
    if (changedRules.length > 0) {
      const table = element("table", "config-by-rule");
      const head = element("tr");
      for (const title of ["Rule", "Now", "With this config"]) {
        const cell = element("th");
        cell.textContent = title;
        head.append(cell);
      }
      table.append(head);
      for (const rule of changedRules) {
        const row = element("tr");
        for (const text of [
          rule.ruleId,
          String(rule.before),
          String(rule.after),
        ]) {
          const cell = element("td");
          cell.textContent = text;
          row.append(cell);
        }
        table.append(row);
      }
      parts.push(table);
    }
    parts.push(
      findingList("New findings", preview.added, preview.addedCount),
      findingList("Gone findings", preview.removed, preview.removedCount),
    );
    const file = document.createElement("details");
    file.className = "config-result";
    const fileSummary = document.createElement("summary");
    fileSummary.textContent = `${this.file.path} with this change`;
    const pre = document.createElement("pre");
    pre.textContent = preview.text;
    file.append(fileSummary, pre);
    parts.push(file);
    this.previewBody.replaceChildren(...parts);
    this.renderActions(preview.text);
  }

  private renderActions(text: string): void {
    const copy = button("Copy");
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(text).then(
        () => (copy.textContent = "Copied"),
        () => (copy.textContent = "Copy failed"),
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
      this.clearDraft();
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
      this.clearDraft();
      // The server reloads the corpus for the new config and tells every page, this one included,
      // to reload; until then the reader knows the write happened.
      this.previewBody.replaceChildren(
        paragraph(
          `Saved to ${this.file.path}. The viewer is reloading the corpus with it.`,
          "config-saved",
        ),
      );
      this.actions.replaceChildren();
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
    try {
      if (this.hasChanges()) {
        sessionStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            base: this.file.hash,
            text: this.text,
            edits: this.edits,
            mode: this.mode,
          }),
        );
      } else {
        sessionStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      // Storage is unavailable; a reload loses the draft, as it would without this.
    }
  }

  private clearDraft(): void {
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // Nothing was stored.
    }
  }

  private restoreDraft(): void {
    let draft:
      | { base: string; text: string; edits: Edit[]; mode: "form" | "text" }
      | undefined;
    try {
      draft =
        JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null") ?? undefined;
    } catch {
      return;
    }
    if (draft === undefined || draft.base !== this.file.hash) {
      return;
    }
    this.text = draft.text;
    this.edits = draft.edits;
    if (this.text !== this.file.text) {
      // The form's model would have to be rebuilt from text, which only the server can parse.
      this.model = null;
      this.mode = "text";
      this.edits = [];
      return;
    }
    for (const edit of this.edits) {
      if (this.model === null) {
        break;
      }
      if (edit.op === "set") {
        this.model = setAt(this.model, edit.path, clone(edit.value ?? null));
      } else if (edit.op === "remove") {
        removeAt(this.model, edit.path);
      } else {
        insertAt(this.model, edit.path, clone(edit.value ?? null));
      }
    }
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

// --- Small helpers -------------------------------------------------------------------------------

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  return node;
}

function button(text: string, className?: string): HTMLButtonElement {
  const node = element("button", className);
  node.type = "button";
  node.textContent = text;
  return node;
}

function paragraph(text: string, className?: string): HTMLParagraphElement {
  const node = element("p", className);
  node.textContent = text;
  return node;
}

function hint(text: string): HTMLElement {
  return paragraph(text, "config-hint");
}

function section(title: string, description: string): HTMLElement {
  const node = element("section", "config-section");
  const heading = element("h2");
  heading.textContent = title;
  node.append(heading, hint(description));
  return node;
}

function labelText(label: string, required: boolean): string {
  return required ? `${label} *` : label;
}

function labelled(
  label: string,
  required: boolean,
  control: HTMLElement,
  description?: string,
): HTMLElement {
  const wrapper = element("label", "config-field");
  const name = element("span", "config-field-name");
  name.textContent = labelText(label, required);
  wrapper.append(name, control);
  if (description !== undefined) {
    wrapper.append(hint(description));
  }
  return wrapper;
}

function findingList(
  title: string,
  findings: Finding[],
  total: number,
): HTMLElement {
  const details = document.createElement("details");
  details.className = "config-findings";
  const summary = document.createElement("summary");
  summary.textContent = `${title} (${total})`;
  const list = element("ul");
  for (const finding of findings) {
    const item = element(
      "li",
      `config-finding config-finding-${finding.severity}`,
    );
    const where = element("code");
    where.textContent =
      finding.line > 0
        ? `${finding.filePath}:${finding.line}`
        : finding.filePath;
    const rule = element("span", "config-finding-rule");
    rule.textContent = `${finding.ruleId} ${finding.severity}`;
    const message = element("span");
    message.textContent = finding.message;
    item.append(where, " ", rule, " ", message);
    list.append(item);
  }
  if (total > findings.length) {
    const more = element("li", "config-hint");
    more.textContent = `…and ${total - findings.length} more.`;
    list.append(more);
  }
  details.append(summary, list);
  return details;
}

function counts(side: { errors: number; warnings: number }): string {
  return `${side.errors} error${side.errors === 1 ? "" : "s"}, ${side.warnings} warning${side.warnings === 1 ? "" : "s"}`;
}

function isPrimitive(schema: JsonSchema): boolean {
  return (
    schema.type === "string" ||
    schema.type === "number" ||
    schema.type === "integer" ||
    schema.type === "boolean"
  );
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function samePath(left: Path, right: Path): boolean {
  return (
    left.length === right.length &&
    left.every((segment, index) => segment === right[index])
  );
}

function getAt(root: Json | null, path: Path): Json | undefined {
  let node: Json | undefined = root ?? undefined;
  for (const segment of path) {
    if (node === undefined || node === null || typeof node !== "object") {
      return undefined;
    }
    node = (node as Record<string | number, Json>)[segment];
  }
  return node;
}

// The same shape `editConfigText` gives the file: objects created on the way down for a missing
// name, so the form and the text agree on what an edit made.
function setAt(root: JsonObject, path: Path, value: Json): JsonObject {
  let node: Json = root;
  path.forEach((segment, index) => {
    const container = node as Record<string | number, Json>;
    if (index === path.length - 1) {
      container[segment] = value;
      return;
    }
    const next = container[segment];
    if (next === undefined || next === null || typeof next !== "object") {
      container[segment] = typeof path[index + 1] === "number" ? [] : {};
    }
    node = container[segment]!;
  });
  return root;
}

function removeAt(root: JsonObject, path: Path): void {
  const parent = getAt(root, path.slice(0, -1));
  const last = path.at(-1)!;
  if (Array.isArray(parent) && typeof last === "number") {
    parent.splice(last, 1);
  } else if (
    parent !== undefined &&
    parent !== null &&
    typeof parent === "object"
  ) {
    delete (parent as Record<string, Json>)[String(last)];
  }
}

function insertAt(root: JsonObject, path: Path, value: Json): void {
  const parent = getAt(root, path.slice(0, -1));
  if (Array.isArray(parent)) {
    parent.splice(Number(path.at(-1)), 0, value);
  }
}
