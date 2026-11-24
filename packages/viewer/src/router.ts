import type { IncomingMessage, ServerResponse } from "node:http";

import { sendEcharts, sendMermaid, sendPackageAsset } from "./asset-routes.js";
import { diffViewOf } from "./change-banner.js";
import { ChangesRoutes } from "./changes-routes.js";
import { ConfigRoutes } from "./config-routes.js";
import { CorpusRoutes } from "./corpus-routes.js";
import { DocumentRoutes } from "./document-routes.js";
import { readBody, sendJson, sendText } from "./http-send.js";
import { decodeRequestPath } from "./request-path.js";
import {
  sendSpeculationRules,
  SPECULATION_RULES_PATH,
} from "./speculation-rules.js";
import { baselineOf } from "./review-state.js";
import {
  CHANGES_OFF_REMOTELY,
  changeRequestProblem,
  isAllowedHostHeader,
  isForeignRequest,
} from "./security.js";
import type { ViewerContext } from "./viewer-context.js";

// The one place every request passes through: the checks that apply to all of them, then the route
// that answers. What each route does lives with its group — a document's page, the Changes page and
// review marks, the config page, the corpus-wide pages, the shipped assets — over one shared
// `ViewerContext`, so every route reads the same corpus and review.

// A config change or a review mark is at most a few kilobytes of JSON; anything far beyond that is
// not one, and reading it into memory would cost the server for nothing.
const MAX_CHANGE_BODY_BYTES = 256 * 1024;

// The only requests with a body the server acts on. Each computes from the config, writes it, opens
// it in another program or records a review mark, so each passes the checks in
// `changeRequestProblem` before its body is read.
const CHANGE_ROUTES = new Set([
  "/api/config/preview",
  "/api/config/save",
  "/api/config/open",
  "/api/review/mark",
  "/api/review/section",
  "/api/review/reset",
]);

/** The address the server is bound to, which the `Host` check compares a request's header with. */
export type BoundAddress = { host: string; port: number };

type Route = (
  request: IncomingMessage,
  response: ServerResponse,
  params: URLSearchParams,
) => Promise<void> | void;

// A route that answers for every address under a prefix, given the rest of the address after it.
type PrefixRoute = readonly [
  prefix: string,
  answer: (
    request: IncomingMessage,
    response: ServerResponse,
    rest: string,
    params: URLSearchParams,
  ) => Promise<void>,
];

export class ViewerRouter {
  private readonly documents: DocumentRoutes;
  private readonly review: ChangesRoutes;
  private readonly config: ConfigRoutes;
  private readonly pages: CorpusRoutes;
  // Addresses answered by exactly one route. A lookup rather than a chain of comparisons: no exact
  // address starts with one of the prefixes below, so which is asked first cannot change the answer.
  private readonly exact: ReadonlyMap<string, Route>;
  // Asked in this order, after the exact addresses.
  private readonly prefixes: readonly PrefixRoute[];

  constructor(
    private readonly ctx: ViewerContext,
    private readonly bound: BoundAddress,
  ) {
    this.documents = new DocumentRoutes(ctx);
    this.review = new ChangesRoutes(ctx);
    this.config = new ConfigRoutes(ctx);
    this.pages = new CorpusRoutes(ctx);
    this.exact = this.exactRoutes();
    this.prefixes = this.prefixRoutes();
  }

  // Every exact address, the pages and the data they ask for, as one lookup.
  private exactRoutes(): ReadonlyMap<string, Route> {
    return new Map([...this.pageRoutes(), ...this.dataRoutes()]);
  }

  // The pages a reader opens, the live-reload stream and the shipped files with fixed addresses.
  private pageRoutes(): [string, Route][] {
    const { documents, review, config, pages, ctx } = this;
    return [
      ["/", (_request, response) => documents.redirectToIndex(response)],
      [
        "/search",
        (request, response, params) =>
          pages.sendSearchPage(request, response, params.get("q") ?? ""),
      ],
      [
        "/graph",
        (request, response, params) =>
          pages.sendGraphPage(request, response, params),
      ],
      [
        "/changes",
        (request, response, params) =>
          review.sendChangesPage(request, response, params),
      ],
      [
        "/dashboard",
        (request, response, params) =>
          pages.sendDashboardPage(request, response, params),
      ],
      [
        "/config",
        (request, response) => config.sendConfigPage(request, response),
      ],
      [
        "/events",
        (request, response) => {
          ctx.events.open(request, response);
        },
      ],
      [
        SPECULATION_RULES_PATH,
        (request, response) => {
          sendSpeculationRules(request, response);
        },
      ],
      [
        "/favicon.ico",
        (request, response) =>
          sendPackageAsset(request, response, "favicon.ico"),
      ],
      [
        "/vendor/echarts/echarts.esm.min.mjs",
        (request, response) => sendEcharts(request, response),
      ],
    ];
  }

  // The JSON the pages ask for.
  private dataRoutes(): [string, Route][] {
    const { documents, review, config, pages } = this;
    return [
      [
        "/api/search",
        (_request, response, params) => {
          pages.sendSearchData(response, params.get("q") ?? "");
        },
      ],
      [
        "/api/graph",
        (_request, response, params) => pages.sendGraphData(response, params),
      ],
      [
        "/api/neighbors",
        (_request, response, params) => pages.sendNeighbors(response, params),
      ],
      [
        "/api/changes",
        (_request, response, params) =>
          review.sendChangesData(response, params),
      ],
      [
        "/api/history",
        (_request, response, params) => documents.sendHistory(response, params),
      ],
      [
        "/api/changes/diff",
        (_request, response, params) => review.sendChangeDiff(response, params),
      ],
      [
        "/api/dashboard",
        (_request, response, params) =>
          pages.sendDashboardData(response, params),
      ],
      ["/api/config", (_request, response) => config.sendConfigData(response)],
      [
        "/api/diagnostics",
        (_request, response, params) => {
          pages.sendDiagnostics(response, params);
        },
      ],
      [
        "/api/diagnostics/panel",
        (_request, response, params) => {
          pages.sendDiagnosticsPanel(response, params);
        },
      ],
      [
        "/api/prompts",
        (_request, response, params) => pages.sendPrompts(response, params),
      ],
    ];
  }

  private prefixRoutes(): readonly PrefixRoute[] {
    const { documents, pages } = this;
    return [
      [
        "/assets/",
        (request, response, rest) => sendPackageAsset(request, response, rest),
      ],
      [
        "/vendor/mermaid/",
        (request, response, rest) => sendMermaid(request, response, rest),
      ],
      [
        "/doc/",
        (request, response, rest, params) =>
          documents.sendDocument(request, response, {
            relPath: decodeRequestPath(rest),
            view: diffViewOf(params),
            baseline: baselineOf(params),
            blame: params.get("blame") === "1",
          }),
      ],
      [
        "/folder/",
        (request, response, rest) =>
          pages.sendFolderPage(request, response, folderOf(rest)),
      ],
      [
        "/file/",
        (request, response, rest) =>
          documents.sendLinkedFile(request, response, decodeRequestPath(rest)),
      ],
    ];
  }

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!isAllowedHostHeader(request.headers.host, this.bound)) {
      sendText(
        response,
        403,
        "Forbidden: this server answers only to localhost.",
      );
      return;
    }
    if (isForeignRequest(request.headers)) {
      sendText(response, 403, "Forbidden: cross-site request.");
      return;
    }
    const [target = "", queryString = ""] = (request.url ?? "")
      .split("#", 1)[0]!
      .split("?", 2);
    if (CHANGE_ROUTES.has(target)) {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        sendText(
          response,
          405,
          "Method not allowed: send the change as a POST.",
        );
        return;
      }
      await this.handleChange(request, response, target);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      sendText(
        response,
        405,
        "Method not allowed: only the config page's and the review marks' requests take a body.",
      );
      return;
    }
    await this.answer(
      request,
      response,
      target,
      new URLSearchParams(queryString),
    );
  }

  // The page or data a read request's address names, or the not-found page when it names nothing.
  private async answer(
    request: IncomingMessage,
    response: ServerResponse,
    target: string,
    params: URLSearchParams,
  ): Promise<void> {
    const route = this.exact.get(target);
    if (route !== undefined) {
      await route(request, response, params);
      return;
    }
    for (const [prefix, answer] of this.prefixes) {
      if (target.startsWith(prefix)) {
        await answer(request, response, target.slice(prefix.length), params);
        return;
      }
    }
    await this.ctx.sendNotFound(
      request,
      response,
      "There is no page at this address.",
    );
  }

  // A request with a body: refused before its body is read unless it came from a page this server
  // rendered, then parsed once here, so every route that takes a body is guarded the same way.
  private async handleChange(
    request: IncomingMessage,
    response: ServerResponse,
    target: string,
  ): Promise<void> {
    const json = await this.readChangeBody(request, response);
    if (json === undefined) {
      return;
    }
    if (target === "/api/config/open") {
      await this.config.openConfig(response, json.value);
    } else if (target === "/api/review/section") {
      await this.review.changeSectionMark(response, json.value);
    } else if (
      target === "/api/review/mark" ||
      target === "/api/review/reset"
    ) {
      await this.review.changeMarks(response, target, json.value);
    } else {
      await this.config.changeConfig(response, target, json.value);
    }
  }

  // The parsed body of a change request, or `undefined` after answering why it is refused. Wrapped,
  // so a body that is valid JSON for `null` is still told apart from a refused one.
  private async readChangeBody(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<{ value: unknown } | undefined> {
    const token = this.ctx.changeToken;
    if (token === undefined) {
      request.resume();
      sendJson(
        response,
        { status: "refused", error: CHANGES_OFF_REMOTELY },
        403,
      );
      return undefined;
    }
    const problem = changeRequestProblem(request.headers, token);
    if (problem !== undefined) {
      request.resume();
      sendJson(
        response,
        { status: "refused", error: problem.message },
        problem.status,
      );
      return undefined;
    }
    const body = await readBody(request, MAX_CHANGE_BODY_BYTES);
    if (body === undefined) {
      sendJson(
        response,
        {
          status: "refused",
          error:
            "The request body is too large to be a config change or a review mark.",
        },
        413,
      );
      return undefined;
    }
    try {
      return { value: JSON.parse(body) as unknown };
    } catch {
      sendJson(
        response,
        { status: "refused", error: "The request body is not valid JSON." },
        400,
      );
      return undefined;
    }
  }
}

// The folder a `/folder/` address names. Its links end in `/`, as a folder's address does on GitHub,
// and the bare prefix is the root; `decodeRequestPath` refuses an empty segment, so that one slash is
// taken off before it judges the rest.
function folderOf(rest: string): string | undefined {
  if (rest === "") {
    return "";
  }
  return decodeRequestPath(rest.endsWith("/") ? rest.slice(0, -1) : rest);
}
