import { button, element } from "./config-dom.js";
import type { FieldRenderer } from "./config-fields.js";
import { displayText } from "./config-json.js";
import type {
  ConfigApi,
  Json,
  JsonObject,
  JsonSchema,
  Path,
  RuleInfo,
} from "./config-types.js";

// The form's Rules section: one collapsible card per configured rule and a picker that adds one. The
// cards change the config only through the editor, which owns the rule ids and which card is open.

/** What the rule cards read from the editor and ask it to do. */
export type RuleListHost = {
  readonly api: ConfigApi;
  readonly fields: FieldRenderer;
  // The resolved id of the rule at this position, `null` for a custom rule or an unknown name.
  ruleId(index: number): string | null;
  configuredIds(): Set<string>;
  isOpen(index: number): boolean;
  current(path: Path): Json | undefined;
  addRule(entry: JsonObject, id: string | null): void;
  removeRule(index: number): void;
};

export function rulesList(
  host: RuleListHost,
  entries: readonly Json[],
): HTMLElement {
  const container = element("div", "config-rule-list");
  entries.forEach((entry, index) => {
    container.append(ruleCard(host, entry as JsonObject, index));
  });
  container.append(ruleAdder(host));
  return container;
}

function ruleAdder(host: RuleListHost): HTMLElement {
  const picker = rulePicker(host);
  const add = button("Add rule");
  add.addEventListener("click", () => {
    const id = picker.value;
    const entry: JsonObject =
      id === "custom"
        ? {
            rule: "custom",
            id: "",
            options: { assert: { kind: firstAssertKind(host.api.schema) } },
          }
        : { rule: id };
    host.addRule(entry, id === "custom" ? null : id);
  });
  const adder = element("div", "config-rule-add");
  adder.append(picker, add);
  return adder;
}

// The rules not configured yet, grouped by category, and a declarative custom rule, which can be
// added any number of times.
function rulePicker(host: RuleListHost): HTMLSelectElement {
  const configured = host.configuredIds();
  const picker = document.createElement("select");
  picker.setAttribute("aria-label", "Rule to add");
  const categories = new Map<string, RuleInfo[]>();
  for (const rule of host.api.rules) {
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
  return picker;
}

// What every part of one rule's card needs to know about the rule.
type CardRule = {
  host: RuleListHost;
  index: number;
  path: Path;
  id: string | null;
  isCustom: boolean;
  info: RuleInfo | undefined;
};

function ruleCard(
  host: RuleListHost,
  entry: JsonObject,
  index: number,
): HTMLElement {
  const id = host.ruleId(index);
  const rule: CardRule = {
    host,
    index,
    path: ["rules", index],
    id,
    isCustom: entry.rule === "custom",
    info:
      id === null ? undefined : host.api.rules.find((known) => known.id === id),
  };
  const card = document.createElement("details");
  card.className = "config-rule";
  card.open = host.isOpen(index);
  const summary = document.createElement("summary");
  const describe = ruleDescriber(rule, summary);
  describe(entry);
  card.append(summary);

  const body = ruleBody(rule);
  // The fields' own listeners update the model first; these run after them as the event bubbles.
  const refresh = () => {
    describe((host.current(rule.path) ?? {}) as JsonObject);
  };
  body.addEventListener("input", refresh);
  body.addEventListener("change", refresh);
  card.append(body);
  return card;
}

// The collapsed card has to say what the rule is set to now, not when the form was drawn: a severity
// changed below and still shown as "off" here reads as a change that did not take. So the summary's
// parts are filled by the function this returns, which the card calls again on every change.
function ruleDescriber(
  rule: CardRule,
  summary: HTMLElement,
): (current: JsonObject) => void {
  const name = element("code", "config-rule-id");
  const description = element("span", "config-rule-description");
  const severity = element("span", "config-rule-severity");
  summary.append(name, description, severity);
  const { id, info, isCustom } = rule;
  return (current) => {
    const customId = displayText(current.id);
    const customName = customId === "" ? "custom rule" : customId;
    name.textContent = isCustom
      ? customName
      : (id ?? displayText(current.rule));
    description.textContent = isCustom
      ? displayText(current.description ?? "Custom rule")
      : (info?.description ?? "");
    severity.textContent = displayText(
      current.severity ?? info?.defaultSeverity,
    );
    // Read by the stylesheet, which tints the pill in the severity's color.
    severity.dataset.severity = severity.textContent;
  };
}

const SEVERITY_SCHEMA: JsonSchema = {
  type: "string",
  enum: ["error", "warning", "off"],
};

function ruleBody(rule: CardRule): HTMLElement {
  const { host, path, isCustom, info } = rule;
  const fields = host.fields;
  const schema = host.api.schema;
  const branch = isCustom
    ? customBranch(schema)
    : builtinBranch(schema, rule.id ?? "");
  const body = element("div", "config-rule-body");
  body.append(
    fields.field({
      schema: SEVERITY_SCHEMA,
      path: [...path, "severity"],
      label: "severity",
      required: false,
      unsetLabel: `default (${info?.defaultSeverity ?? "per finding"})`,
    }),
  );
  if (isCustom) {
    body.append(...customRuleFields(fields, path, branch));
  }
  const optionsSchema = branch?.properties?.options;
  if (optionsSchema !== undefined) {
    body.append(
      fields.field({
        schema: optionsSchema,
        path: [...path, "options"],
        label: "options",
        required: isCustom,
      }),
    );
  }
  body.append(ruleFooter(rule));
  return body;
}

// A custom rule names itself: an id, which is required, an optional description, and its target.
function customRuleFields(
  fields: FieldRenderer,
  path: Path,
  branch: JsonSchema | undefined,
): HTMLElement[] {
  const properties = branch?.properties ?? {};
  return [
    fields.field({
      schema: { type: "string" },
      path: [...path, "id"],
      label: "id",
      required: true,
    }),
    fields.field({
      schema: { type: "string" },
      path: [...path, "description"],
      label: "description",
      required: false,
    }),
    fields.field({
      schema: properties.target ?? { type: "string" },
      path: [...path, "target"],
      label: "target",
      required: false,
    }),
  ];
}

function ruleFooter(rule: CardRule): HTMLElement {
  const footer = element("div", "config-rule-footer");
  if (rule.info?.docsUrl !== undefined) {
    const docs = document.createElement("a");
    docs.href = rule.info.docsUrl;
    docs.target = "_blank";
    docs.rel = "noopener noreferrer";
    docs.textContent = "Rule documentation";
    footer.append(docs);
  }
  const remove = button("Remove rule", "config-danger");
  remove.addEventListener("click", () => {
    rule.host.removeRule(rule.index);
  });
  footer.append(remove);
  return footer;
}

function builtinBranch(schema: JsonSchema, id: string): JsonSchema | undefined {
  return ruleBranches(schema).find(
    (branch) => branch.properties?.rule?.enum?.includes(id) === true,
  );
}

// The generic custom branch: `const: "custom"` with an id *pattern*. A project-local schema would
// add one branch per known custom id, but the package schema the server sends has only this one.
function customBranch(schema: JsonSchema): JsonSchema | undefined {
  return ruleBranches(schema).find(
    (branch) =>
      branch.properties?.rule?.const === "custom" &&
      branch.properties.id?.pattern !== undefined,
  );
}

function ruleBranches(schema: JsonSchema): JsonSchema[] {
  return schema.properties?.rules?.items?.oneOf ?? [];
}

// A new custom rule starts with the first assertion kind the schema lists, so its card opens with
// that kind's fields to fill in rather than an empty choice.
function firstAssertKind(schema: JsonSchema): string {
  const assert = customBranch(schema)?.properties?.options?.properties?.assert;
  return displayText(assert?.oneOf?.[0]?.properties?.kind?.const);
}
