#!/bin/bash
# Isoleret testinstallation af Alekos-pluginet — rører IKKE din normale Claude Code-opsætning (~/.claude).
#
#   bash opsaetning/test-isoleret.sh          (opsæt og start Claude Code i testmappen)
#   bash opsaetning/test-isoleret.sh --toerk  (vis kun, hvad der ville ske)
#   bash opsaetning/test-isoleret.sh --slet   (slet testmappen igen)
#
# Testmappen: ~/Alekos-plugintest
#   konfig/   = Claude Codes opsætning til testen (CLAUDE_CONFIG_DIR peger hertil, ikke på ~/.claude)
#   arbejde/  = mappen Claude Code åbnes i
set -euo pipefail

ROD="$(cd "$(dirname "$0")/.." && pwd)"
TEST="$HOME/Alekos-plugintest"
KONFIG="$TEST/konfig"
ARBEJDE="$TEST/arbejde"
TOERK=0
[ "${1:-}" = "--toerk" ] && TOERK=1

if [ "${1:-}" = "--slet" ]; then
  [ -d "$TEST" ] || { echo "Ingen testmappe at slette."; exit 0; }
  echo "Sletter $TEST (din normale ~/.claude røres ikke)."
  rm -rf "$TEST"
  echo "✓ Slettet."
  exit 0
fi

# Værn: testen må aldrig pege på den rigtige opsætning.
if [ "$KONFIG" = "$HOME/.claude" ] || [ "$TEST" = "$HOME" ]; then echo "✗ Testmappen peger på din normale opsætning. Stop."; exit 1; fi

# Find Claude Code CLI: i PATH, ellers VS Code-udvidelsens indbyggede binær (nyeste version).
CLAUDE="$(command -v claude || true)"
if [ -z "$CLAUDE" ]; then
  CLAUDE="$(ls -d "$HOME"/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude 2>/dev/null | sort -V | tail -1 || true)"
fi
if [ -z "$CLAUDE" ] || [ ! -x "$CLAUDE" ]; then
  echo "✗ Fandt ikke Claude Code. Installer CLI'en med:  npm i -g @anthropic-ai/claude-code   og kør scriptet igen."
  exit 1
fi

koer() {
  echo "  \$ $*"
  [ "$TOERK" = 1 ] || "$@"
}

echo "Claude Code:     $CLAUDE"
echo "Plugin-mappe:    $ROD"
echo "Testopsætning:   $KONFIG   (CLAUDE_CONFIG_DIR — din ~/.claude røres ikke)"
echo "Arbejdsmappe:    $ARBEJDE"
echo

koer mkdir -p "$KONFIG" "$ARBEJDE"
export CLAUDE_CONFIG_DIR="$KONFIG"

echo "1) Installerer pluginet i testopsætningen"
koer "$CLAUDE" plugin marketplace add "$ROD"
koer "$CLAUDE" plugin install alekos@alekos-intern

echo "2) Sikkerhedsreglerne sætter pluginet selv ved første start (hooks/opstart.mjs) — kun i testopsætningen."
echo "   Start Claude Code, luk den igen (/exit), og start den på ny, så sandkassen er slået til."

echo
echo "3) Starter Claude Code i $ARBEJDE"
echo "   Første gang skal du logge ind på din Claude-konto igen (testopsætningen er tom)."
echo "   Alekos-login: skriv /mcp, vælg alekos og log ind — browseren åbner Admin-siden \"Forbind Claude\"."
[ "$TOERK" = 1 ] && { echo "  \$ cd $ARBEJDE && CLAUDE_CONFIG_DIR=$KONFIG $CLAUDE"; exit 0; }
cd "$ARBEJDE"
exec "$CLAUDE"
