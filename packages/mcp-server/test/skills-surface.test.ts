import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createServer } from "../src/index.js";

// Drift guard (deliverable 3, MCP half): the MCP tools/inputs/results the impact skill documents must
// match the server's live advertised schema. Rather than hand-maintaining a separate matrix — which
// could silently fall out of step with the skill — this test PARSES the tool snippets straight out of
// the skill body and asserts the parsed contract against the live input/output schemas. A skill that
// documents a different tool, or renames/moves a field, changes this parse and fails here.
const impactSkill = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../skills/wastech-mdlint-impact/SKILL.md"),
  "utf8"
);

interface DocumentedTool {
  name: string;
  inputFields: string[];
  outputFields: string[];
}

// Turn a documented `{ a, b?, c: "x" }` code span into its field names: drop the optional `?`, keep
// only the key before any `:` value, ignore anything that is not a bare identifier.
function braceFields(span: string): string[] {
  const inner = /\{([^}]*)\}/.exec(span)?.[1] ?? "";
  return inner
    .split(",")
    .map((part) => part.trim().replace(/\?$/, "").split(":")[0]!.trim())
    .filter((token) => /^[A-Za-z][A-Za-z0-9]*$/.test(token));
}

// Extract every MCP tool the skill documents (a dashed tool name followed by the word "tool"), then
// read its input brace (the `{…}` after "Input", or — for tools configured inline like context-graph —
// the first brace in its section) and its result brace (the `{…}` after "returns"/"shaped", if any).
function parseDocumentedTools(): DocumentedTool[] {
  const mentions = [...impactSkill.matchAll(/`([a-z]+-[a-z]+)` tool/g)];
  const names = [...new Set(mentions.map((m) => m[1]!))];

  return names.map((name) => {
    const start = impactSkill.indexOf(`\`${name}\` tool`);
    // Bound each tool's section at the next documented tool mention so braces never leak across tools.
    const nextStarts = names
      .map((other) => impactSkill.indexOf(`\`${other}\` tool`))
      .filter((index) => index > start);
    const end = nextStarts.length > 0 ? Math.min(...nextStarts) : impactSkill.length;
    const section = impactSkill.slice(start, end);

    const inputMatch = /Input\s*`?\{[^}]*\}/.exec(section);
    const inputFields = braceFields(inputMatch?.[0] ?? /`?\{[^}]*\}/.exec(section)?.[0] ?? "");

    const outputMatch = /(?:returns|Returns|shaped)[^`]*`\{[^}]*\}/.exec(section);
    const outputFields = outputMatch === null ? [] : braceFields(outputMatch[0]);

    return { name, inputFields, outputFields };
  });
}

function properties(schema: unknown): string[] {
  const props = (schema as { properties?: Record<string, unknown> } | undefined)?.properties;
  return props === undefined ? [] : Object.keys(props);
}

describe("skills reference a live MCP surface", () => {
  it("every MCP tool the impact skill documents matches the live input/output schema", async () => {
    const documented = parseDocumentedTools();
    // Sanity-pin the parse itself so a broken extractor cannot make the assertions below vacuous.
    expect(documented.map((tool) => tool.name).sort()).toEqual([
      "context-graph",
      "context-slice",
      "impact-analysis"
    ]);

    const server = await createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "skills-surface", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    for (const { name, inputFields, outputFields } of documented) {
      const tool = byName.get(name);
      expect(tool, `tool ${name} is not advertised`).toBeDefined();

      // The parse must have found something to check — an empty field list would silently pass.
      expect(inputFields.length, `no documented inputs parsed for ${name}`).toBeGreaterThan(0);

      const inputProps = properties(tool?.inputSchema);
      for (const field of inputFields) {
        expect(inputProps, `${name} input schema is missing documented field ${field}`).toContain(field);
      }

      const outputProps = properties(tool?.outputSchema);
      for (const field of outputFields) {
        expect(outputProps, `${name} output schema is missing documented field ${field}`).toContain(field);
      }
    }

    // The graph fallback relies specifically on `format: "summary"`; assert the live enum still offers
    // it, since a renamed/removed value would make the documented call fail.
    expect(impactSkill).toContain('{ format: "summary" }');
    const graphInput = byName.get("context-graph")?.inputSchema as
      | { properties?: { format?: unknown } }
      | undefined;
    expect(JSON.stringify(graphInput?.properties?.format)).toContain("summary");

    await client.close();
    await server.close();
  });
});
