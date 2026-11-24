import type { IncomingMessage, ServerResponse } from "node:http";

import type { ElementContent } from "hast";
import { toHtml } from "hast-util-to-html";
import { h } from "hastscript";

import { compareStrings } from "@wastech-mdlint/core";

import { dashboardChanges, graphChanges } from "./branch-changes.js";
import {
  buildDashboard,
  dashboardCsv,
  parseDashboardQuery,
  type DashboardSource,
} from "./dashboard.js";
import { renderDashboardArticle } from "./dashboard-article.js";
import {
  buildGraphView,
  buildNeighborhoodView,
  graphFolders,
  type GraphView,
  renderGraphArticle,
  withChanges,
} from "./graph-view.js";
import { sendHtml, sendJson } from "./http-send.js";
import { renderFindingsPanel } from "./findings-panel.js";
import { findingPrompts } from "./prompts.js";
import { workTreeChanges } from "./review-queries.js";
import { pageHeaders } from "./security.js";
import type { ViewerContext } from "./viewer-context.js";

// The pages about the corpus as a whole — search, the link graph, the dashboard — and the findings
// and fix prompts every document page asks for.

const GRAPH_NOT_FOUND =
  "The graph shows a folder that holds corpus documents, and can highlight a document in the corpus; this address names something else.";

export class CorpusRoutes {
  constructor(private readonly ctx: ViewerContext) {}

  async sendSearchPage(
    request: IncomingMessage,
    response: ServerResponse,
    query: string,
  ): Promise<void> {
    const hits = this.ctx.search.search(this.ctx.corpus.documents, query);
    const article: ElementContent[] =
      query.trim().length === 0
        ? [h("h1", "Search"), h("p", "Type a word or phrase to search for.")]
        : [
            h("h1", `Search: ${query}`),
            hits.length === 0
              ? h("p", "No documents match.")
              : h(
                  "ol.search-page-results",
                  hits.map((hit) =>
                    h("li", [
                      h("a.search-hit-title", { href: hit.href }, [
                        ...markTerms(hit.title, hit.terms),
                      ]),
                      h("div.search-hit-path", hit.path),
                      h("p.search-hit-snippet", [
                        ...markTerms(hit.snippet, hit.terms),
                      ]),
                    ]),
                  ),
                ),
          ];
    sendHtml(
      response,
      200,
      await this.ctx.page({
        title: query ? `Search: ${query}` : "Search",
        article,
        query,
      }),
      request.method === "HEAD",
    );
  }

  sendSearchData(response: ServerResponse, query: string): void {
    sendJson(response, {
      query,
      results: this.ctx.search.search(this.ctx.corpus.documents, query),
    });
  }

  // The folder and focused document a graph request names, or `undefined` when either is not part of
  // the corpus. Both are only compared against the corpus's own paths, never joined onto a
  // filesystem path, so nothing a request writes here reaches the disk.
  private parseGraphRequest(
    params: URLSearchParams,
  ): { folder: string; focus: string | undefined } | undefined {
    const folder = params.get("folder") ?? "";
    // `focus=` with nothing after it, as a hand-edited address may carry, focuses nothing.
    const focusParam = params.get("focus");
    const focus =
      focusParam === null || focusParam === "" ? undefined : focusParam;
    if (
      (folder !== "" &&
        !graphFolders(this.ctx.corpus.documents.keys()).includes(folder)) ||
      (focus !== undefined && !this.ctx.corpus.documents.has(focus))
    ) {
      return undefined;
    }
    return { folder, focus };
  }

  // `changes=1` marks the branch's changes on a graph view; without it, or without a branch to
  // compare, the view is the graph as it is.
  private async graphWithChanges(
    view: GraphView,
    params: URLSearchParams,
  ): Promise<GraphView> {
    if (params.get("changes") !== "1") {
      return view;
    }
    const branch = await workTreeChanges(this.ctx);
    return branch === undefined
      ? view
      : withChanges(
          view,
          this.ctx.corpus.graph,
          graphChanges(branch.review, branch.context),
        );
  }

  async sendGraphPage(
    request: IncomingMessage,
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> {
    const graphRequest = this.parseGraphRequest(params);
    if (graphRequest === undefined) {
      await this.ctx.sendNotFound(request, response, GRAPH_NOT_FOUND);
      return;
    }
    const view = await this.graphWithChanges(
      buildGraphView(
        this.ctx.corpus.graph,
        this.ctx.corpus.documents,
        graphRequest.folder,
        graphRequest.focus,
      ),
      params,
    );
    sendHtml(
      response,
      200,
      await this.ctx.page({
        title: "Link graph",
        section: "graph",
        article: renderGraphArticle(
          view,
          graphFolders(this.ctx.corpus.documents.keys()),
          graphRequest.focus,
          this.ctx.changes === undefined
            ? undefined
            : { shown: params.get("changes") === "1" },
        ),
      }),
      request.method === "HEAD",
    );
  }

  async sendGraphData(
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> {
    const graphRequest = this.parseGraphRequest(params);
    if (graphRequest === undefined) {
      sendJson(response, { error: GRAPH_NOT_FOUND }, 404);
      return;
    }
    sendJson(
      response,
      await this.graphWithChanges(
        buildGraphView(
          this.ctx.corpus.graph,
          this.ctx.corpus.documents,
          graphRequest.folder,
          graphRequest.focus,
        ),
        params,
      ),
    );
  }

  async sendNeighbors(
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> {
    // Only ever compared against the corpus's own paths, like the graph's parameters.
    const relPath = params.get("path") ?? "";
    if (!this.ctx.corpus.documents.has(relPath)) {
      sendJson(
        response,
        { error: "This path is not a document in the corpus." },
        404,
      );
      return;
    }
    sendJson(
      response,
      await this.graphWithChanges(
        buildNeighborhoodView(
          this.ctx.corpus.graph,
          this.ctx.corpus.documents,
          relPath,
        ),
        params,
      ),
    );
  }

  private async dashboardSource(): Promise<DashboardSource> {
    const findings = this.ctx.diagnostics.messagesByFile;
    // The rules a reader can pick: the ones the config runs, plus any other id a finding carries,
    // such as the report about a malformed suppression comment.
    const ruleIds = new Set(
      this.ctx.corpus.configuration.rules
        .filter(({ severity }) => severity !== "off")
        .map(({ rule }) => rule.id),
    );
    for (const messages of findings?.values() ?? []) {
      for (const message of messages) {
        ruleIds.add(message.ruleId);
      }
    }
    const branch = await workTreeChanges(this.ctx);
    return {
      documents: this.ctx.corpus.documents,
      graph: this.ctx.corpus.graph,
      findings,
      ruleIds: [...ruleIds].sort(compareStrings),
      folders: graphFolders(this.ctx.corpus.documents.keys()),
      ...(branch === undefined
        ? {}
        : { changes: dashboardChanges(branch.review, branch.context) }),
    };
  }

  async sendDashboardPage(
    request: IncomingMessage,
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> {
    const source = await this.dashboardSource();
    const parsed = parseDashboardQuery(params, source);
    sendHtml(
      response,
      parsed.ok ? 200 : 400,
      await this.ctx.page({
        title: "Dashboard",
        section: "dashboard",
        firstScreen: true,
        article: renderDashboardArticle(
          parsed.ok
            ? {
                params,
                source,
                ok: true,
                query: parsed.query,
                result: buildDashboard(source, parsed.query),
              }
            : { params, source, ok: false, message: parsed.message },
        ),
      }),
      request.method === "HEAD",
    );
  }

  async sendDashboardData(
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> {
    const source = await this.dashboardSource();
    const parsed = parseDashboardQuery(params, source, ["format"]);
    const format = params.get("format") ?? "";
    if (!parsed.ok || !["", "json", "csv"].includes(format)) {
      sendJson(
        response,
        {
          error: parsed.ok
            ? `Unknown format "${format}": use csv or json.`
            : parsed.message,
        },
        400,
      );
      return;
    }
    const result = buildDashboard(source, parsed.query);
    if (format === "csv") {
      response.writeHead(200, {
        ...pageHeaders(),
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="dashboard.csv"',
      });
      response.end(dashboardCsv(result));
      return;
    }
    sendJson(
      response,
      { query: parsed.query, ...result },
      200,
      format === "json"
        ? { "Content-Disposition": 'attachment; filename="dashboard.json"' }
        : {},
    );
  }

  sendDiagnostics(response: ServerResponse, params: URLSearchParams): void {
    if (!this.ctx.diagnostics.ready) {
      sendJson(response, { status: "pending" });
      return;
    }
    const relPath = params.get("path");
    if (relPath === null) {
      sendJson(response, {
        status: "ready",
        files: this.ctx.diagnostics.summary(),
      });
      return;
    }
    const document = this.ctx.corpus.documents.get(relPath);
    sendJson(response, {
      status: "ready",
      findings:
        document === undefined ? [] : this.ctx.diagnostics.findings(document),
    });
  }

  /**
   * `/api/diagnostics/panel?path=…`: a document's findings panel as the page draws it, for the page
   * script to put in place of its own after a lint, so the panel has one renderer. Empty when the
   * document has no findings; `204` while the first lint is still running, when the page keeps what
   * it shows.
   */
  sendDiagnosticsPanel(
    response: ServerResponse,
    params: URLSearchParams,
  ): void {
    if (!this.ctx.diagnostics.ready) {
      response.writeHead(204, pageHeaders()).end();
      return;
    }
    const relPath = params.get("path");
    const document =
      relPath === null ? undefined : this.ctx.corpus.documents.get(relPath);
    const panel =
      relPath === null || document === undefined
        ? undefined
        : renderFindingsPanel(relPath, this.ctx.diagnostics.findings(document));
    sendHtml(response, 200, panel === undefined ? "" : toHtml(panel));
  }

  async sendPrompts(
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> {
    const line = params.get("line");
    const answer = await findingPrompts({
      corpus: this.ctx.corpus,
      findings: this.ctx.diagnostics.messagesByFile,
      // Only ever compared against the corpus's own paths and the findings' own rule ids.
      filePath: params.get("path") ?? "",
      ruleId: params.get("rule") ?? undefined,
      line: line === null ? undefined : Number(line),
    });
    sendJson(response, answer.body, answer.status);
  }
}

// The server-rendered twin of the client's highlighting: matched words wrapped in <mark>, built as
// hast so the text around them is escaped.
function markTerms(text: string, terms: readonly string[]): ElementContent[] {
  const escaped = terms
    .filter((term) => term.length > 0)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) {
    return [{ type: "text", value: text }];
  }
  return text
    .split(new RegExp(`(${escaped.join("|")})`, "giu"))
    .map((part, index) =>
      index % 2 === 0 ? { type: "text", value: part } : h("mark", part),
    );
}
