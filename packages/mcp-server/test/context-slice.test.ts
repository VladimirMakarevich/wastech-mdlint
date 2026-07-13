import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ContextSliceResult } from "@wastech-mdlint/core";
import { describe, expect, it } from "vitest";

import { createServer } from "../src/index.js";
import { handleContextSlice } from "../src/tools/context-slice.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);
const graphProject = path.join(fixturesDir, "graph-project");

function structured(
  result: Awaited<ReturnType<typeof handleContextSlice>>,
): ContextSliceResult {
  return result.structuredContent as unknown as ContextSliceResult;
}

describe("handleContextSlice", () => {
  it("resolves a file path and slices forward within depth", async () => {
    const result = await handleContextSlice({
      cwd: graphProject,
      query: "guide.md",
      depth: 1,
    });

    expect(result.isError).toBeFalsy();
    const output = structured(result);
    expect(output.matchKind).toBe("path");
    expect(output.files).toEqual(["guide.md", "requirements.md"]);
  });

  it("resolves a defined ID to its owning file", async () => {
    const result = await handleContextSlice({
      cwd: graphProject,
      query: "REQ-1",
    });

    expect(result.isError).toBeFalsy();
    const output = structured(result);
    expect(output.matchKind).toBe("id");
    expect(output.starts).toEqual(["requirements.md"]);
    expect(output.files).toEqual(["requirements.md"]);
  });

  it("resolves a leading-# query as an anchor", async () => {
    const result = await handleContextSlice({
      cwd: graphProject,
      query: "#requirements",
    });

    expect(result.isError).toBeFalsy();
    expect(structured(result).matchKind).toBe("anchor");
  });

  it("returns an honest empty result (not an error) for an unresolved query", async () => {
    const result = await handleContextSlice({
      cwd: graphProject,
      query: "not-a-real-query",
    });

    expect(result.isError).toBeFalsy();
    expect(structured(result)).toMatchObject({
      matchKind: null,
      starts: [],
      files: [],
      visited: [],
    });
  });

  // A negative `depth` is not a meaningful hop bound; the input schema must reject it at the wire
  // level (mirroring the CLI's `--depth` guard) rather than let it degrade to a start-only slice.
  // Exercised through a real client so the SDK's input validation runs, not just the handler.
  it("rejects a negative depth at input validation", async () => {
    const server = await createServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "context-slice-depth", version: "0.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "context-slice",
      arguments: { query: "guide.md", depth: -1 },
    });
    expect(result.isError).toBe(true);

    await client.close();
    await server.close();
  });
});
