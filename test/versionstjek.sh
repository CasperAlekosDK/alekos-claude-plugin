#!/bin/bash
# Stopper en udgivelse uden højere version (samme version kan overskrive mappen, som en kørende session bruger).
# Kør før push:  bash test/versionstjek.sh
set -eu
cd "$(dirname "$0")/.."
git fetch -q origin main
NY=$(python3 -c 'import json;print(json.load(open("plugins/alekos/.claude-plugin/plugin.json"))["version"])')
GL=$(git show origin/main:plugins/alekos/.claude-plugin/plugin.json | python3 -c 'import json,sys;print(json.load(sys.stdin)["version"])')
if [ "$(git diff --name-only origin/main -- plugins .claude-plugin | wc -l | tr -d ' ')" = 0 ]; then echo "✓ Ingen ændringer i pluginet (version $NY)."; exit 0; fi
python3 -c 'import sys;a,b=[tuple(map(int,v.split("."))) for v in sys.argv[1:]];sys.exit(0 if a>b else 1)' "$NY" "$GL" \
  && echo "✓ Version $GL → $NY." || { echo "✗ Pluginet er ændret, men versionen er stadig $NY (GitHub: $GL). Hæv den i plugins/alekos/.claude-plugin/plugin.json."; exit 1; }
