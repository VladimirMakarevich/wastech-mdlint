# Rules index

> [Guide index](../README.md) · [Configuration](../configuration.md) · [Annotated config](../config-reference.md)

`wastech-mdlint` ships **24 built-in rules** across 8 categories, plus the declarative
[`custom`](custom.md) rule. Every rule has a Zod-validated options schema, a fixed **scope**
(`document` = per file · `project` = once over the whole corpus), and a default **severity**
(`error` | `warning`) you can override per entry. Enable rules in your
[config](../configuration.md); most accept `files`/`exclude` to narrow their reach.

> There is **no `CHK` category** — checklist completeness is [CTX-002](CTX-002.md).

## All rules

| Rule | Category | Scope | Default | Fixable | Checks |
| --- | --- | --- | --- | --- | --- |
| [TBL-001](TBL-001.md) | TBL | document | error | no | Tables declare their required columns. |
| [TBL-002](TBL-002.md) | TBL | document | warning | **yes** | Target table cells are not empty. |
| [TBL-003](TBL-003.md) | TBL | document | error | no | Cell values fall within an allowed set. |
| [TBL-004](TBL-004.md) | TBL | document | error | no | Cell values match a required pattern. |
| [TBL-005](TBL-005.md) | TBL | document | error | no | Cross-column conditional holds (when → then). |
| [TBL-006](TBL-006.md) | TBL | project | error | no | Column IDs are unique across files. |
| [SEC-001](SEC-001.md) | SEC | document | error | **yes** | Required sections are present. |
| [SEC-002](SEC-002.md) | SEC | document | error | no | Sections appear in the required order. |
| [SEC-003](SEC-003.md) | SEC | project | error | no | Sections conform to a template's heading structure. |
| [STR-001](STR-001.md) | STR | project | error | no | Required files exist in the project. |
| [REF-001](REF-001.md) | REF | document | error | no | Relative links resolve to a file. |
| [REF-002](REF-002.md) | REF | document | error | no | Link anchors match a heading slug. |
| [REF-003](REF-003.md) | REF | document | error | no | Image targets resolve to a file. |
| [REF-004](REF-004.md) | REF | document | error | no | Cross-zone links are declared in the zone's Dependencies. |
| [REF-005](REF-005.md) | REF | project | error | no | IDs are traceable between definitions and references. |
| [REF-006](REF-006.md) | REF | project | warning | no | References do not depend on less-stable entities. |
| [CTX-001](CTX-001.md) | CTX | document | warning | no | Sections are not empty or placeholder-only. |
| [CTX-002](CTX-002.md) | CTX | document | warning | no | All checklist items are checked. |
| [CTX-003](CTX-003.md) | CTX | project | warning | no | Content uses canonical glossary terms instead of aliases. |
| [GRP-001](GRP-001.md) | GRP | project | error | no | No circular references between documents. |
| [GRP-002](GRP-002.md) | GRP | project | warning | no | Documents have at least one incoming reference (except entry points). |
| [GRP-003](GRP-003.md) | GRP | project | warning | no | IDs are carried forward across pipeline stages. |
| [SIZE-001](SIZE-001.md) | SIZE | document | warning | no | File stays within byte / line / token budgets. |
| [LLM-001](LLM-001.md) | LLM | project | warning | no | Eager-import context stays within the per-entrypoint token budget. |
| [custom](custom.md) | custom | derived | error | no | Declarative rule composed from a closed assertion vocabulary. |

The built-in rows mirror the machine-generated table in the top-level [README](../../../README.md)
(`npm run generate:docs`). The per-rule pages here add prose, options tables, and examples.

## Categories

- **TBL — tables.** Enforce table schemas: required columns, non-empty cells, allowed/patterned
  values, cross-column rules, and cross-file ID uniqueness.
- **SEC — sections.** Required sections, section order, and template conformance.
- **STR — structure.** Required files exist.
- **REF — references.** Links, anchors, and images resolve; cross-zone dependency declaration; ID
  traceability and stability direction.
- **CTX — content quality.** No empty/placeholder sections, checklist completeness, glossary term
  usage.
- **GRP — graph integrity.** No cycles, no orphans, ID chains across stages — over the shared
  [context graph](../context-graph.md).
- **SIZE / LLM — context hygiene.** Byte/line/token budgets per file, and eager-import token
  budgets per entrypoint.
- **custom — declarative.** Compose the closed assertion vocabulary from config, no code.

## Severity & suppression

- Set `severity` per entry to `"error" | "warning" | "off"`; `"off"` documents but disables a rule.
- Suppress individual findings inline — see [Suppression](../suppression.md).
- Two document-scope rules are **fixable** via `lint --fix`: [SEC-001](SEC-001.md) and
  [TBL-002](TBL-002.md).
