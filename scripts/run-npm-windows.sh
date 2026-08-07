#!/usr/bin/env bash
set -euo pipefail

# Runs the Windows npm/Node toolchain against this checkout from inside WSL.
#
# W-54 (P16.04): this used to flatten the argument vector into one string (`npm_args="$*"`) and
# interpolate it, unquoted, together with the repository path into a single cmd.exe command line
# (`cmd.exe /d /s /c "cd /d $repo_root_win && npm ... $npm_args"`), so a checkout path containing a
# space broke and one containing `&` injected. `.agents/rules/security.md` (Command Execution)
# requires an explicit argument vector, so the command line is not built here at all: bash changes
# into the repository itself and hands cmd.exe the caller's vector as-is. Quoting the pieces instead
# would have kept the construction and moved the risk into a hand-rolled cmd quoting routine — the
# part that goes subtly wrong (caret escaping, and `%VAR%` has no command-line escape at all).
#
# Residual, deliberately not fixed because no construction avoids it: cmd.exe expands `%VAR%` in
# whatever command line it ends up with. The four callers (build/install/test/typecheck-wsl.sh) pass
# literal words only.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v cmd.exe >/dev/null 2>&1; then
  echo "cmd.exe is required to run Windows Node.js from WSL." >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  echo "Usage: scripts/run-npm-windows.sh <npm arguments...>" >&2
  exit 1
fi

# The Windows child gets this checkout as its working directory through WSL's interop translation
# of the bash cwd, which only produces a usable path for a checkout on a Windows drive. A checkout
# on the WSL filesystem translates to a UNC path, which cmd.exe refuses as a working directory
# (it falls back to C:\Windows, and npm then reports a missing script — a failure that reads as a
# broken repository rather than an unsupported location). The previous `cd /d \\wsl$\...` form
# failed on exactly the same limitation; refusing by name is what makes it legible.
repo_root_win="$(wslpath -w "$repo_root")"
if [[ "$repo_root_win" == '\\'* ]]; then
  echo "This checkout is on the WSL filesystem ($repo_root_win); cmd.exe cannot use a UNC path as its working directory. Clone under a Windows drive (e.g. /mnt/c/...) to run the Windows toolchain." >&2
  exit 1
fi

cd "$repo_root"

# No `--engine-strict=false` here any more. P16.03 (W-32) decided the engines question the other
# way: the root .npmrc sets `engine-strict=true`, and npm reads it from this working directory. A
# Windows Node below the declared floor therefore now fails `install-wsl.sh` — deliberately, since
# this platform combination is the one these scripts exist to cover and was the one place the floor
# was being suppressed. Do not re-add the flag; change the decision in P16.03's place instead.
#
# `/s` is inert now that the string after `/c` no longer starts with a quote, but it is kept so this
# stays the invocation cmd.exe documents rather than a variant of it.
exec cmd.exe /d /s /c npm "$@"
