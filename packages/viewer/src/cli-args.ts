import { parseArgs } from "node:util";

import { DEFAULT_HOST, isLoopbackHost } from "./security.js";

export const DEFAULT_PORT = 4180;

export const USAGE = `Usage: wastech-mdlint-viewer [path] [options]

Serve the repository's Markdown as web pages on this machine.

Arguments:
  path               Repository directory (default: the current directory)

Options:
  -p, --port <n>     Port to listen on (default: ${DEFAULT_PORT}, or the next free one)
      --host <host>  Address to bind (default: ${DEFAULT_HOST}, this machine only)
  -c, --config <f>   wastech-mdlint config file (default: found in the repository)
      --base <ref>   Branch, tag or commit the Changes section compares with
                     (default: the branch origin/HEAD names, then main, then master)
      --no-watch     Do not reload pages when files change
      --allow-config-writes
                     Let the config page save changes to the config file
  -h, --help         Show this help
`;

export type CliArgs =
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      cwd: string;
      configPath?: string;
      base?: string;
      host: string;
      port: number;
      portExplicit: boolean;
      watch: boolean;
      allowConfigWrites: boolean;
    };

/** Parse the command line into what to do. Pure, so every outcome is testable without a server. */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    return { kind: "error", message: (error as Error).message };
  }
  const { values, positionals } = parsed;
  if (values.help === true) {
    return { kind: "help" };
  }
  if (positionals.length > 1) {
    return {
      kind: "error",
      message: `Expected one path, got ${positionals.length}.`,
    };
  }

  let port = DEFAULT_PORT;
  if (values.port !== undefined) {
    // `Number("")` is 0 and `Number(" 8 ")` is 8, so the text is checked as digits before converting.
    port = /^\d+$/.test(values.port) ? Number(values.port) : Number.NaN;
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      return { kind: "error", message: `Invalid port: ${values.port}` };
    }
  }

  const host = values.host ?? DEFAULT_HOST;
  const allowConfigWrites = values["allow-config-writes"] === true;
  // Anyone who can open the config page can save from it. On this machine's loopback address that
  // is the user; bound to a network address it would be anyone who can reach the port.
  if (allowConfigWrites && !isLoopbackHost(host)) {
    return {
      kind: "error",
      message: `--allow-config-writes works only on a loopback address, not with --host ${host}: anyone who can reach the viewer could rewrite the config.`,
    };
  }

  return {
    kind: "run",
    cwd: positionals[0] ?? ".",
    configPath: values.config,
    base: values.base,
    host,
    port,
    portExplicit: values.port !== undefined,
    watch: values["no-watch"] !== true,
    allowConfigWrites,
  };
}

function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      port: { type: "string", short: "p" },
      host: { type: "string" },
      config: { type: "string", short: "c" },
      base: { type: "string" },
      "no-watch": { type: "boolean" },
      "allow-config-writes": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
}
