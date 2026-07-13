import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "./index.js";

// M3 generator: render the README's MCP tool inventory from the *live* registered tools rather than
// a hand-maintained name list. `tools/index.ts` deliberately keeps its registrars function-only so
// no second source of truth can drift ("5 vs 6 tools"); introspecting a connected client — the same
// `createServer()` + `InMemoryTransport` + `listTools()` technique `smoke.test.ts` uses — is the
// only generic, non-private-field way to enumerate what is actually advertised.

// Guard the table's Markdown against free-text descriptions: a `|` would split a cell and a newline
// would break the row. None of the six current descriptions contain either, but the table is
// machine-generated from prose a future tool author could grow one into — escaping here closes that
// off permanently rather than leaving a latent doc-corruption risk.
function escapeCell(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

export async function generateToolInventory(): Promise<string> {
  const server = await createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wastech-mdlint-doc-generator", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const { tools } = await client.listTools();

    const header = "| Tool | Description | Read-only | Structured output |";
    const divider = "| --- | --- | --- | --- |";
    // Registration order is preserved deliberately (not alphabetized): it groups by family
    // (lint/lint-files, the three graph tools, then compile-context last as the M1 five-tool
    // exception), which reads better than alphabetical and is still fully deterministic — the order
    // comes from a fixed registrar array, not filesystem or Map-iteration order.
    const rows = tools.map((tool) => {
      const readOnly = tool.annotations?.readOnlyHint === true ? "yes" : "no";
      const structured = tool.outputSchema !== undefined ? "yes" : "no";
      return `| \`${tool.name}\` | ${escapeCell(tool.description ?? "")} | ${readOnly} | ${structured} |`;
    });

    return [header, divider, ...rows].join("\n");
  } finally {
    await client.close();
    await server.close();
  }
}
