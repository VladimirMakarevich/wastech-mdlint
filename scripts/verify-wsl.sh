#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$script_dir/install-wsl.sh"
"$script_dir/typecheck-wsl.sh"
"$script_dir/test-wsl.sh"
"$script_dir/build-wsl.sh"
