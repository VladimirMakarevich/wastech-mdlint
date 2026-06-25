#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root_win="$(wslpath -w "$repo_root")"

if ! command -v cmd.exe >/dev/null 2>&1; then
  echo "cmd.exe is required to run Windows Node.js from WSL." >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  echo "Usage: scripts/run-npm-windows.sh <npm arguments...>" >&2
  exit 1
fi

npm_args="$*"

exec cmd.exe /d /s /c "cd /d $repo_root_win && npm --engine-strict=false $npm_args"
