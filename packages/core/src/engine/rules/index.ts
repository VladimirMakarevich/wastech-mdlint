import { RuleRegistry, type RuleDefinition } from "../registry.js";
import { CTX_RULES } from "./ctx.js";
import { GRP_RULES } from "./grp.js";
import { LLM_RULES } from "./llm.js";
import { REF_RULES } from "./ref.js";
import { size001 } from "./size.js";
import { TBL_RULES } from "./tbl.js";
import { SEC_STR_RULES } from "./sec.js";

// Central registration point for built-in rules. Each rule family appends its definitions here, so
// the registry, schema, and README all derive from one list. Kept explicit (not side-effect
// registration) so build order and tree-shaking never drop a rule silently.
export const BUILTIN_RULE_DEFINITIONS: readonly RuleDefinition[] = [
  size001,
  ...LLM_RULES,
  ...TBL_RULES,
  ...SEC_STR_RULES,
  ...REF_RULES,
  ...CTX_RULES,
  ...GRP_RULES
];

// The process-wide registry over the built-ins. Config loading, schema generation, and the CLI all
// consult this single instance.
export const ruleRegistry = new RuleRegistry(BUILTIN_RULE_DEFINITIONS);
