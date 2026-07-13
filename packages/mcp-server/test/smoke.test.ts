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

    await client.close();
    await server.close();
  });
});
