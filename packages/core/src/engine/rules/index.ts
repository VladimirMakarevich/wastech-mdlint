import { RuleRegistry, type RuleDefinition } from "../registry.js";
import { ref001 } from "./ref.js";
import { size001 } from "./size.js";

// Central registration point for built-in rules. Each rule family (P2.07 proof rules, then the full
// P3 set) appends its definitions here, so the registry, schema, and README all derive from one
// list. Kept explicit (not side-effect registration) so build order and tree-shaking never drop a
// rule silently.
export const BUILTIN_RULE_DEFINITIONS: readonly RuleDefinition[] = [ref001, size001];

// The process-wide registry over the built-ins. Config loading, schema generation, and the CLI all
// consult this single instance.
export const ruleRegistry = new RuleRegistry(BUILTIN_RULE_DEFINITIONS);
