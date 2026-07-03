import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";

import { createServer } from "../src/index.js";

// P0.06 smoke check: prove the stub builds, speaks MCP over a real transport, and — crucially —
// registers no tools. A linked in-memory transport pair is used instead of stdio so the check is
// deterministic and never seizes the test runner's stdin/stdout; the wire-level StdioServerTransport
// integration tests belong to P7 when the six tools land.
describe("mcp-server stub", () => {
  it("completes the MCP handshake and exposes no tools yet", async () => {
    const server = await createServer();
    expect(server).toBeInstanceOf(McpServer);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "mcp-server-smoke", version: "0.0.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    // Handshake completed if the client sees the server's advertised identity.
    expect(client.getServerVersion()).toMatchObject({
      name: "wastech-mdlint-mcp"
    });

    // No tools capability is advertised because the stub registers none, so tools/list is an
    // unknown method (JSON-RPC -32601). This is the guard that keeps P0 from smuggling in the
    // P7 tool surface.
    await expect(client.listTools()).rejects.toThrow(/Method not found/);

    await client.close();
    await server.close();
  });
});
