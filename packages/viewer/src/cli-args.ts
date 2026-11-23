import { parseArgs } from "node:util";

import { DEFAULT_HOST } from "./security.js";

export const DEFAULT_PORT = 4180;

export const USAGE = `Usage: wastech-mdlint-viewer [path] [options]

Serve the repository's Markdown as web pages on this machine.

Arguments:
  path               Repository directory (default: the current directory)

Options:
  -p, --port <n>     Port to listen on (default: ${DEFAULT_PORT}, or the next free one)
      --host <host>  Address to bind (default: ${DEFAULT_HOST}, this machine only)
  -c, --config <f>   wastech-mdlint config file (default: found in the repository)
      --no-watch     Do not reload pages when files change
  -h, --help         Show this help
`;

export type CliArgs =
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      cwd: string;
      configPath?: string;
      host: string;
      port: number;
      portExplicit: boolean;
      watch: boolean;
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

  return {
    kind: "run",
    cwd: positionals[0] ?? ".",
    configPath: values.config,
    host: values.host ?? DEFAULT_HOST,
    port,
    portExplicit: values.port !== undefined,
    watch: values["no-watch"] !== true,
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
      "no-watch": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
}
