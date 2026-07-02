import type { AuditConfig, Finding, MarkdownFile } from "../types.js";
import { matchesConfigGlob } from "../discovery/globs.js";

const RULE_ID = "size/max-file-size";

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function resolveMaxBytesForFile(filePath: string, config: AuditConfig): number {
  for (const override of config.size.overrides) {
    if (matchesConfigGlob(filePath, [override.pattern])) {
      return override.maxBytes;
    }
  }

  return config.size.maxBytesDefault;
}

function formatPercentOver(actualBytes: number, maxBytes: number): string {
  const percentOver = ((actualBytes - maxBytes) / maxBytes) * 100;
  return percentOver.toFixed(1);
}

export function checkFileSizes(params: {
  files: MarkdownFile[];
  config: AuditConfig;
}): Finding[] {
  const findings: Finding[] = [];

  for (const file of params.files) {
    const maxBytes = resolveMaxBytesForFile(file.path, params.config);

    if (file.bytes <= maxBytes) {
      continue;
    }

    const tokenEstimate = file.text === undefined ? undefined : estimateTokens(file.text);
    const tokenSuffix =
      tokenEstimate === undefined ? "" : ` Estimated tokens: ${tokenEstimate}.`;

    findings.push({
      ruleId: RULE_ID,
      severity: "warning",
      path: file.path,
      message: `File is over size limit: ${file.bytes} bytes exceeds ${maxBytes} bytes (${formatPercentOver(
        file.bytes,
        maxBytes
      )}% over).${tokenSuffix}`
    });
  }

  findings.sort((left, right) => {
    return (
      left.path.localeCompare(right.path) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      (left.column ?? 0) - (right.column ?? 0) ||
      left.message.localeCompare(right.message)
    );
  });

  return findings;
}
