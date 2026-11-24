// The shapes the config page exchanges with the server: the schema core generates, the rule
// registry's summary, the edits the form makes, and the preview the server answers with. Types only,
// shared by the config editor's modules so each of them reads the same contract.

export type JsonSchema = {
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

export type RuleInfo = {
  id: string;
  alias: string;
  category: string;
  description: string;
  defaultSeverity: string;
  fixable: boolean;
  docsUrl?: string;
};

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type JsonObject = Record<string, Json>;
export type Path = (string | number)[];

export type ConfigApi = {
  file: { path: string; text: string; hash: string } | null;
  config: JsonObject | null;
  ruleIds: (string | null)[];
  errors: string[];
  writeBlocked: string | null;
  schema: JsonSchema;
  rules: RuleInfo[];
};

export type Edit = {
  op: "set" | "remove" | "insert";
  path: Path;
  value?: Json;
};

export type Finding = {
  filePath: string;
  line: number;
  ruleId: string;
  severity: string;
  message: string;
};

export type OkPreview = {
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
};

export type Preview =
  | OkPreview
  | { status: "invalid"; errors: string[]; text?: string }
  | { status: "conflict" | "refused" | "failed"; error: string };
