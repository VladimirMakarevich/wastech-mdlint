import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SLICE_RESOLUTION_DESCRIPTION } from "@wastech-mdlint/core";
import { describe, expect, it } from "vitest";

import { createServer } from "../src/index.js";

// Smoke check: prove the server builds, speaks MCP over a real transport, and advertises exactly
// the tools registered so far. A linked in-memory transport pair is used instead of stdio so the
// check is deterministic and never seizes the test runner's stdin/stdout; the wire-level
// StdioServerTransport integration tests belong to P7.05 when the full six-tool surface lands.
describe("mcp-server", () => {
  it("completes the MCP handshake and advertises the registered tools", async () => {
    const server = await createServer();
    expect(server).toBeInstanceOf(McpServer);

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "mcp-server-smoke", version: "0.0.0" });

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    // Handshake completed if the client sees the server's advertised identity.
    expect(client.getServerVersion()).toMatchObject({
      name: "wastech-mdlint-mcp",
    });

    // P7.02 landed `lint`/`lint-files`; P7.03 added the three graph tools; P7.04 lands the last tool
    // (`compile-context`), completing the six-tool surface.
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "compile-context",
      "context-graph",
      "context-slice",
      "impact-analysis",
      "lint",
      "lint-files",
    ]);

    // Pin AC2 ("context-slice description is honest") at the wire level: the tool must advertise
    // core's exact exact-match wording rather than separately worded, over-promising copy.
    const slice = tools.find((tool) => tool.name === "context-slice");
    expect(slice?.description).toContain(SLICE_RESOLUTION_DESCRIPTION);

    // P9.04/M2: ad-hoc lint does not load config, but selected rules can still touch cwd paths.
    const lint = tools.find((tool) => tool.name === "lint");
    expect(lint?.description).toContain("Does not load project config");
    expect(lint?.description).toContain("REF-001/REF-003");
    // P11.12: STR-001 joined the filesystem-probing rules, so the description must name it too.
    expect(lint?.description).toContain("STR-001");
    expect(lint?.description).toContain("server's working directory");
    expect(lint?.description).not.toContain("Reads no filesystem");
    // P12.04/M8: ad-hoc lint runs declarative custom rules, and the `content.md` file-scope caveat
    // that comes with them is disclosed rather than left to be discovered.
    expect(lint?.description).toContain("code plugins are never loaded");
    expect(lint?.description).toContain("content.md");

    // The widened input schema must survive JSON Schema conversion *and* be advertised — an agent
    // can only send a custom entry if the custom branch is visible here. Converting `assertionSchema`
    // is the risky part (a `z.toJSONSchema` failure throws during `listTools`), so this pins the
    // branch itself, not merely that the server still answers.
    const ruleItems = (
      lint?.inputSchema as {
        properties?: { rules?: { items?: { anyOf?: unknown[] } } };
      }
    ).properties?.rules?.items;
    const customBranch = ruleItems?.anyOf?.find(
      (branch) =>
        (branch as { properties?: { rule?: { const?: unknown } } }).properties
          ?.rule?.const === "custom",
    ) as
      | { properties?: { options?: { properties?: Record<string, unknown> } } }
      | undefined;
    expect(customBranch?.properties?.options?.properties?.assert).toBeDefined();

    await client.close();
    await server.close();
  });
});
