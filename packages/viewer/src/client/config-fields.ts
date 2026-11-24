import {
  button,
  element,
  hint,
  labelled,
  labelText,
  paragraph,
} from "./config-dom.js";
import { displayText } from "./config-json.js";
import type { Json, JsonSchema, Path } from "./config-types.js";
import { segmentedControl } from "./segmented.js";

// The config form's inputs, one kind per shape the schema can describe. A field never keeps a value
// of its own: it reads the editor's model when drawn and hands every change back to the editor, which
// records it as an edit of the file's text.

/** What a field reads and changes: the editor's model, by path. */
export type FieldModel = {
  get(path: Path): Json | undefined;
  set(path: Path, value: Json): void;
  remove(path: Path): void;
  insert(path: Path, value: Json): void;
};

export type FieldSpec = {
  schema: JsonSchema;
  path: Path;
  label: string;
  required: boolean;
  // Names the "not set" choice of a select or segmented control, where the default is known better
  // than the schema says — a rule's own default severity, for one.
  unsetLabel?: string;
  // A list's row is a bare input: the list names it, and an empty row stays a row being typed into
  // rather than removing the value.
  inList?: boolean;
};

export class FieldRenderer {
  private readonly model: FieldModel;

  constructor(model: FieldModel) {
    this.model = model;
  }

  /** One input, or a group of them, for the value the schema describes at `path`. */
  field(spec: FieldSpec): HTMLElement {
    const { schema } = spec;
    if (isKindUnion(schema)) {
      return this.kindField(schema.oneOf, spec);
    }
    if (schema.type === "object" && schema.properties !== undefined) {
      return this.objectField(spec, schema.properties);
    }
    if (schema.type === "array" && schema.items !== undefined) {
      return this.arrayField(spec, schema.items);
    }
    if (schema.enum !== undefined || schema.type === "boolean") {
      return this.choiceField(spec, schema.enum ?? [true, false]);
    }
    if (
      schema.type === "string" ||
      schema.type === "number" ||
      schema.type === "integer"
    ) {
      return this.inputField(spec);
    }
    return this.jsonField(spec);
  }

  private objectField(
    spec: FieldSpec,
    properties: Record<string, JsonSchema>,
  ): HTMLElement {
    const group = element("fieldset", "config-group");
    const legend = element("legend");
    legend.textContent = labelText(spec.label, spec.required);
    group.append(legend);
    if (spec.schema.description !== undefined) {
      group.append(hint(spec.schema.description));
    }
    const requiredKeys = new Set(spec.schema.required ?? []);
    for (const [key, child] of Object.entries(properties)) {
      group.append(
        this.field({
          schema: child,
          path: [...spec.path, key],
          label: key,
          required: requiredKeys.has(key),
        }),
      );
    }
    return group;
  }

  private arrayField(spec: FieldSpec, items: JsonSchema): HTMLElement {
    if (
      isPrimitive(items) ||
      (items.type === "object" && items.properties !== undefined)
    ) {
      return this.listField(spec, items);
    }
    return this.jsonField(spec);
  }

  // A few choices — a boolean, a severity — are shown all at once as a segmented control, one click
  // to change; a longer list stays a select, where a row of segments would run off the form.
  private choiceField(spec: FieldSpec, choices: unknown[]): HTMLElement {
    return choices.length <= 3
      ? this.segmentedField(spec, choices)
      : this.selectField(spec, choices);
  }

  private segmentedField(spec: FieldSpec, choices: unknown[]): HTMLElement {
    const { path } = spec;
    const control = segmentedControl<string>(
      labelText(spec.label, spec.required),
      [
        ["", unsetLabel(spec, "not set")],
        ...choices.map(
          (choice) => [JSON.stringify(choice), String(choice)] as const,
        ),
      ],
      (chosen) => {
        if (chosen === "") {
          this.model.remove(path);
        } else {
          this.model.set(path, JSON.parse(chosen) as Json);
        }
        // Bubbled like a select's change, so a rule card's summary follows the new severity.
        control.element.dispatchEvent(new Event("change", { bubbles: true }));
      },
    );
    const value = this.model.get(path);
    control.render(value === undefined ? "" : JSON.stringify(value));
    return labelled(control.element, {
      label: spec.label,
      required: spec.required,
      description: spec.schema.description,
      wrapperTag: "div",
    });
  }

  private selectField(spec: FieldSpec, choices: unknown[]): HTMLElement {
    const { path } = spec;
    const select = document.createElement("select");
    select.append(new Option(unsetLabel(spec, "—"), ""));
    for (const choice of choices) {
      select.append(new Option(String(choice), JSON.stringify(choice)));
    }
    const value = this.model.get(path);
    select.value = value === undefined ? "" : JSON.stringify(value);
    select.addEventListener("change", () => {
      if (select.value === "") {
        this.model.remove(path);
      } else {
        this.model.set(path, JSON.parse(select.value) as Json);
      }
    });
    return labelled(select, {
      label: spec.label,
      required: spec.required,
      description: spec.schema.description,
    });
  }

  private inputField(spec: FieldSpec): HTMLElement {
    const input = document.createElement("input");
    const numeric = spec.schema.type !== "string";
    configureInput(input, spec.schema, numeric);
    const value = this.model.get(spec.path);
    input.value =
      value === undefined || value === null ? "" : displayText(value);
    input.addEventListener("input", () => {
      this.applyInput(input, spec, numeric);
    });
    return spec.inList === true
      ? input
      : labelled(input, {
          label: spec.label,
          required: spec.required,
          description: spec.schema.description,
        });
  }

  // An emptied field is left out of the config rather than set to "", except in a list, where the
  // row stays until it is removed. A number that does not parse yet is not applied at all.
  private applyInput(
    input: HTMLInputElement,
    spec: FieldSpec,
    numeric: boolean,
  ): void {
    if (input.value === "" && spec.inList !== true) {
      this.model.remove(spec.path);
      return;
    }
    if (!numeric) {
      this.model.set(spec.path, input.value);
      return;
    }
    const number = Number(input.value);
    if (input.value !== "" && Number.isFinite(number)) {
      this.model.set(spec.path, number);
    }
  }

  // A union told apart by its `kind`, such as a custom rule's assertion: pick the kind, then fill in
  // that kind's fields. Picking another kind starts the value over, since the fields differ.
  private kindField(branches: JsonSchema[], spec: FieldSpec): HTMLElement {
    const { path } = spec;
    const group = element("fieldset", "config-group");
    const legend = element("legend");
    legend.textContent = labelText(spec.label, spec.required);
    const current = this.model.get(path) as Record<string, Json> | undefined;
    const select = document.createElement("select");
    for (const branch of branches) {
      const kind = String(branch.properties!.kind!.const);
      select.append(new Option(kind, kind));
    }
    select.value = displayText(current?.kind);
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
            this.field({
              schema: child,
              path: [...path, key],
              label: key,
              required: requiredKeys.has(key),
            }),
          ),
      );
    };
    select.addEventListener("change", () => {
      this.model.set(path, { kind: select.value });
      renderFields();
    });
    group.append(
      legend,
      labelled(select, { label: "kind", required: true }),
      fields,
    );
    renderFields();
    return group;
  }

  private listField(spec: FieldSpec, items: JsonSchema): HTMLElement {
    const { path, required } = spec;
    const group = element("fieldset", "config-group config-list");
    const legend = element("legend");
    legend.textContent = labelText(spec.label, required);
    const list = element("div", "config-list-items");
    const add = button("Add", "config-add");
    const emptyNote = this.emptyListNote(path, () => {
      render();
    });

    const render = (focusLast = false) => {
      const values = this.model.get(path);
      const array = Array.isArray(values) ? values : [];
      emptyNote.hidden = required || !Array.isArray(values) || array.length > 0;
      list.replaceChildren(
        ...array.map((_, index) =>
          this.listRow({
            spec,
            items,
            index,
            count: array.length,
            rerender: render,
          }),
        ),
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
      const fresh = freshItem(items);
      const values = this.model.get(path);
      if (Array.isArray(values)) {
        this.model.insert([...path, values.length], fresh);
      } else {
        this.model.set(path, [fresh]);
      }
      render(true);
    });
    group.append(legend);
    if (spec.schema.description !== undefined) {
      group.append(hint(spec.schema.description));
    }
    group.append(emptyNote, list, add);
    render();
    return group;
  }

  // An optional list that is present but empty is not the same as one left out: an empty `files`
  // matches no file at all, so the rule it scopes checks nothing. Removing the last entry therefore
  // removes the list, and an empty one already in the file is pointed out with a way to remove it.
  private emptyListNote(path: Path, rerender: () => void): HTMLElement {
    const emptyNote = element("div", "config-list-empty");
    const emptyText = paragraph(
      "This list is empty, which is not the same as leaving it out: an empty list matches nothing.",
      "config-hint",
    );
    const dropEmpty = button("Remove the empty list", "config-remove");
    dropEmpty.addEventListener("click", () => {
      this.model.remove(path);
      rerender();
    });
    emptyNote.append(emptyText, dropEmpty);
    return emptyNote;
  }

  private listRow(row: {
    spec: FieldSpec;
    items: JsonSchema;
    index: number;
    count: number;
    rerender: () => void;
  }): HTMLElement {
    const { spec, items, index } = row;
    const primitive = isPrimitive(items);
    const container = element(
      "div",
      primitive ? "config-list-row" : "config-list-object",
    );
    const itemPath = [...spec.path, index];
    const itemLabel = `${spec.label} ${index + 1}`;
    const control = this.field({
      schema: items,
      path: itemPath,
      label: itemLabel,
      required: true,
      inList: primitive,
    });
    if (
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement
    ) {
      control.setAttribute("aria-label", itemLabel);
    }
    const remove = button("Remove", "config-remove");
    remove.setAttribute("aria-label", `Remove ${itemLabel}`);
    remove.addEventListener("click", () => {
      this.model.remove(
        !spec.required && row.count === 1 ? spec.path : itemPath,
      );
      row.rerender();
    });
    container.append(control, remove);
    return container;
  }

  // For a value the form has no inputs for — a map from names to lists, say — the value itself, as
  // JSON. It is applied when it parses, and core judges it like any other.
  private jsonField(spec: FieldSpec): HTMLElement {
    const { path } = spec;
    const textarea = document.createElement("textarea");
    textarea.className = "config-json";
    textarea.spellcheck = false;
    const value = this.model.get(path);
    textarea.value = value === undefined ? "" : JSON.stringify(value, null, 2);
    const problem = element("span", "config-json-problem");
    textarea.addEventListener("change", () => {
      if (textarea.value.trim() === "") {
        problem.textContent = "";
        this.model.remove(path);
        return;
      }
      try {
        const parsed = JSON.parse(textarea.value) as Json;
        problem.textContent = "";
        this.model.set(path, parsed);
      } catch {
        problem.textContent = "Not valid JSON yet.";
      }
    });
    const wrapper = labelled(textarea, {
      label: `${spec.label} (JSON)`,
      required: spec.required,
      description: spec.schema.description,
    });
    wrapper.append(problem);
    return wrapper;
  }
}

function isKindUnion(
  schema: JsonSchema,
): schema is JsonSchema & { oneOf: JsonSchema[] } {
  return (
    schema.oneOf?.every(
      (branch) => branch.properties?.kind?.const !== undefined,
    ) === true
  );
}

export function isPrimitive(schema: JsonSchema): boolean {
  return (
    schema.type === "string" ||
    schema.type === "number" ||
    schema.type === "integer" ||
    schema.type === "boolean"
  );
}

// The "not set" choice says what not setting means when the schema has a default.
function unsetLabel(spec: FieldSpec, fallback: string): string {
  if (spec.unsetLabel !== undefined) {
    return spec.unsetLabel;
  }
  return spec.schema.default === undefined
    ? fallback
    : `default (${displayText(spec.schema.default)})`;
}

function configureInput(
  input: HTMLInputElement,
  schema: JsonSchema,
  numeric: boolean,
): void {
  input.type = numeric ? "number" : "text";
  if (numeric) {
    input.step = schema.type === "integer" ? "1" : "any";
    const min = schema.minimum ?? schema.exclusiveMinimum;
    if (min !== undefined) {
      input.min = String(min);
    }
    return;
  }
  input.spellcheck = false;
  if (schema.pattern !== undefined) {
    input.title = `Pattern: ${schema.pattern}`;
  }
}

// What a new row starts as: empty text, zero, or an object whose fields are then filled in.
function freshItem(items: JsonSchema): Json {
  if (!isPrimitive(items)) {
    return {};
  }
  return items.type === "string" ? "" : 0;
}
