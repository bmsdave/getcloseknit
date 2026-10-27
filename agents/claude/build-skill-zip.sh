#!/usr/bin/env bash
# Package the find-a-home skill for claude.ai / Claude Desktop chat (Settings → Capabilities →
# Skills → Upload). The ZIP holds the skill folder at its root, as the upload expects.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/dist/find-a-home.zip}"
mkdir -p "$(dirname "$out")"
out="$(cd "$(dirname "$out")" && pwd)/$(basename "$out")"
rm -f "$out"
(cd "$here/plugin/skills" && zip -qr "$out" find-a-home -x '*.DS_Store')
echo "$out"
