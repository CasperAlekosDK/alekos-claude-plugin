#!/bin/bash
# Test af opstartsreglen (hooks/opstart.mjs) i falske mapper — rører intet rigtigt. Kør: bash test/opstart-test.sh
set -u
O="$(cd "$(dirname "$0")/.." && pwd)/plugins/alekos/hooks/opstart.mjs"
S="$(mktemp -d)"
pass=0; fail=0
ok(){ if eval "$2"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FEJL: $1"; fi; }
koer(){ # $1 = konfigmappe ("" = ingen CLAUDE_CONFIG_DIR), $2 = HOME
  if [ -n "$1" ]; then out="$(HOME="$2" CLAUDE_CONFIG_DIR="$1" CLAUDE_PLUGIN_ROOT="$1/plugins/cache/x" node "$O")"; else out="$(HOME="$2" CLAUDE_CONFIG_DIR= node "$O")"; fi
  rc=$?
}
felt(){ python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(eval(sys.argv[2]))' "$1" "$2" 2>/dev/null; }
nb(){ ls "$1" 2>/dev/null | grep -c '^settings.json.alekos-backup-' ; }

# 1) Tom opsætning: reglerne sættes, besked vises, ingen backup (der var ingen fil)
K="$S/k1"; mkdir -p "$K"; koer "$K" "$S/h1"
ok "1 exit 0" '[ $rc = 0 ]'
ok "1 sandkasse slået til" '[ "$(felt "$K/settings.json" "d[\"sandbox\"][\"enabled\"]")" = True ]'
ok "1 gem_forslag spørger" '[ "$(felt "$K/settings.json" "\"mcp__plugin_alekos_alekos__gem_forslag\" in d[\"permissions\"][\"ask\"]")" = True ]'
ok "1 Supabase spærret" '[ "$(felt "$K/settings.json" "\"*.supabase.co\" in d[\"sandbox\"][\"network\"][\"deniedDomains\"]")" = True ]'
ok "1 testmappen er skrivebeskyttet" '[ "$(felt "$K/settings.json" "\"$K\" in d[\"sandbox\"][\"filesystem\"][\"denyWrite\"]")" = True ]'
ok "1 pluginets cache-mappe tilføjes ikke pr. version" '[ "$(felt "$K/settings.json" "any(\"plugins/cache\" in x for x in d[\"sandbox\"][\"filesystem\"][\"denyWrite\"])")" = False ]'
ok "1 besked om genstart" 'printf "%s" "$out" | grep -q "er sat"'
ok "1 ingen backup uden fil" '[ "$(nb "$K")" = 0 ]'

# 2) Igen: intet ændres, ingen besked, ingen backup (idempotent)
h1="$(shasum "$K/settings.json")"; koer "$K" "$S/h1"
ok "2 uændret" '[ "$(shasum "$K/settings.json")" = "$h1" ]'
ok "2 ingen besked" '[ -z "$out" ]'
ok "2 ingen backup" '[ "$(nb "$K")" = 0 ]'

# 3) Eksisterende indstillinger: bevares, excludedCommands og bypass fjernes, backup tages
K="$S/k3"; mkdir -p "$K"
printf '%s' '{"model":"opus","permissions":{"allow":["Bash(git *)","mcp__plugin_alekos_alekos__gem_forslag"],"defaultMode":"bypassPermissions"},"sandbox":{"excludedCommands":["docker"]},"enabledPlugins":{"alekos@alekos-intern":true}}' > "$K/settings.json"
foer="$(cat "$K/settings.json")"; koer "$K" "$S/h3"
ok "3 model bevaret" '[ "$(felt "$K/settings.json" "d[\"model\"]")" = opus ]'
ok "3 egen allow bevaret" '[ "$(felt "$K/settings.json" "\"Bash(git *)\" in d[\"permissions\"][\"allow\"]")" = True ]'
ok "3 allow på gem fjernet" '[ "$(felt "$K/settings.json" "\"mcp__plugin_alekos_alekos__gem_forslag\" in d[\"permissions\"][\"allow\"]")" = False ]'
ok "3 bypass fjernet" '[ "$(felt "$K/settings.json" "\"defaultMode\" in d[\"permissions\"]")" = False ]'
ok "3 excludedCommands fjernet" '[ "$(felt "$K/settings.json" "\"excludedCommands\" in d[\"sandbox\"]")" = False ]'
ok "3 plugins bevaret" '[ "$(felt "$K/settings.json" "d[\"enabledPlugins\"][\"alekos@alekos-intern\"]")" = True ]'
ok "3 én backup med det gamle indhold" '[ "$(nb "$K")" = 1 ] && [ "$(cat "$K"/settings.json.alekos-backup-*)" = "$foer" ]'
ok "3 besked" 'printf "%s" "$out" | grep -q "Alekos: sikkerhedsreglerne"'
koer "$K" "$S/h3"; ok "3b anden kørsel uændret" '[ -z "$out" ] && [ "$(nb "$K")" = 1 ]'

# 4) Ugyldig JSON: ændres aldrig, besked i stedet
K="$S/k4"; mkdir -p "$K"; printf '{"a":' > "$K/settings.json"; koer "$K" "$S/h4"
ok "4 exit 0" '[ $rc = 0 ]'
ok "4 uændret" '[ "$(cat "$K/settings.json")" = "{\"a\":" ]'
ok "4 besked" 'printf "%s" "$out" | grep -q "gyldig JSON"'
printf '[1,2]' > "$K/settings.json"; koer "$K" "$S/h4"
ok "4b liste ændres ikke" '[ "$(cat "$K/settings.json")" = "[1,2]" ]'

# 5) Symlink: ændres aldrig (kunne pege på en anden fil)
K="$S/k5"; mkdir -p "$K"; echo '{}' > "$S/andet.json"; ln -s "$S/andet.json" "$K/settings.json"; koer "$K" "$S/h5"
ok "5 mål uændret" '[ "$(cat "$S/andet.json")" = "{}" ]'
ok "5 besked" 'printf "%s" "$out" | grep -q "link"'

# 6) Højst 5 backups
K="$S/k6"; mkdir -p "$K"
for i in 1 2 3 4 5 6 7; do printf '{"n":%s}' "$i" > "$K/settings.json"; koer "$K" "$S/h6"; sleep 0.01; done
ok "6 højst 5 backups" '[ "$(nb "$K")" = 5 ]'

# 7) Caspers egen opsætning (~/.claude som brugeren casperkloster) røres aldrig
if [ "$(id -un)" = "casperkloster" ]; then
  H="$S/caspershjem"; mkdir -p "$H/.claude"; echo '{"x":1}' > "$H/.claude/settings.json"; koer "" "$H"
  ok "7 Caspers settings uændret" '[ "$(cat "$H/.claude/settings.json")" = "{\"x\":1}" ]'
  ok "7 ingen besked, ingen backup" '[ -z "$out" ] && [ "$(nb "$H/.claude")" = 0 ]'
  H2="$S/tomt"; mkdir -p "$H2"; koer "" "$H2"
  ok "7b opretter ikke ~/.claude/settings.json" '[ ! -e "$H2/.claude/settings.json" ]'
else
  echo "(7 springes over: ikke Caspers Mac)"
fi

# 8) Mappe uden skriveret: exit 0 + besked (stopper aldrig Claude Code)
K="$S/k8"; mkdir -p "$K"; echo '{}' > "$K/settings.json"; chmod 500 "$K"; koer "$K" "$S/h8"; chmod 700 "$K"
ok "8 exit 0" '[ $rc = 0 ]'
ok "8 besked om fejl" 'printf "%s" "$out" | grep -q "kunne ikke sættes"'
ok "8 uændret" '[ "$(cat "$K/settings.json")" = "{}" ]'

# 9) Første backup (før Alekos) slettes aldrig, og fjernede undtagelser nævnes
K="$S/k9"; mkdir -p "$K"; printf '{"sandbox":{"excludedCommands":["docker"]}}' > "$K/settings.json"; koer "$K" "$S/h9"
ok "9 nævner docker" 'printf "%s" "$out" | grep -q "docker"'
for i in 1 2 3 4 5 6 7; do printf '{"n":%s}' "$i" > "$K/settings.json"; koer "$K" "$S/h9"; done
ok "9 første backup bevaret" '[ "$(cat "$K/settings.json.foer-alekos")" = "{\"sandbox\":{\"excludedCommands\":[\"docker\"]}}" ]'

# 10) BOM i starten af filen godtages
K="$S/k10"; mkdir -p "$K"; printf '\xef\xbb\xbf{"model":"x"}' > "$K/settings.json"; koer "$K" "$S/h10"
ok "10 BOM: regler sat, model bevaret" '[ "$(felt "$K/settings.json" "d[\"model\"]")" = x ] && [ "$(felt "$K/settings.json" "d[\"sandbox\"][\"enabled\"]")" = True ]'

# 11) known_marketplaces.json med / eller hjemmemappen må aldrig blive skrivebeskyttet
K="$S/k11"; H="$S/h11"; mkdir -p "$K/plugins" "$H"
printf '{"alekos-intern":{"installLocation":"/","source":{"source":"directory","path":"%s"}}}' "$H" > "$K/plugins/known_marketplaces.json"
koer "$K" "$H"
ok "11 hverken / eller hjemmemappen i denyWrite" '[ "$(felt "$K/settings.json" "any(x in (\"/\", \"$H\") for x in d[\"sandbox\"][\"filesystem\"][\"denyWrite\"])")" = False ]'
ok "11 ingen Edit(///**)" '! grep -q "Edit(///\*\*)" "$K/settings.json"'
M="$S/fremmed"; mkdir -p "$M/.claude-plugin"; echo '{"name":"noget-andet"}' > "$M/.claude-plugin/marketplace.json"
printf '{"alekos-intern":{"installLocation":"%s"}}' "$M" > "$K/plugins/known_marketplaces.json"; rm "$K/settings.json"; koer "$K" "$H"
ok "11b fremmed markedsplads tilføjes ikke" '! grep -q "$M" "$K/settings.json"'
M2="$S/rigtig"; mkdir -p "$M2/.claude-plugin"; echo '{"name":"alekos-intern"}' > "$M2/.claude-plugin/marketplace.json"
printf '{"alekos-intern":{"installLocation":"%s"}}' "$M2" > "$K/plugins/known_marketplaces.json"; rm "$K/settings.json"; koer "$K" "$H"
ok "11c Alekos' markedsplads tilføjes" 'grep -q "$(cd "$M2" && pwd -P)" "$K/settings.json"'

# 12) Fire samtidige starter: ingen fejlbesked, gyldig JSON, reglerne sat
for runde in 1 2 3 4 5; do
  K="$S/k12-$runde"; mkdir -p "$K"; echo '{"model":"y"}' > "$K/settings.json"; : > "$S/ud12"
  for i in 1 2 3 4; do (HOME="$S/h12" CLAUDE_CONFIG_DIR="$K" node "$O" >> "$S/ud12"; echo >> "$S/ud12") & done; wait
  ok "12.$runde ingen fejlbesked" '! grep -q "kunne ikke" "$S/ud12"'
  ok "12.$runde gyldig + regler" '[ "$(felt "$K/settings.json" "d[\"sandbox\"][\"enabled\"] and d[\"model\"]")" = y ]'
  ok "12.$runde ingen lås tilbage" '[ ! -e "$K/.alekos-opstart.laas" ]'
done

# 13) Caspers værn kan ikke omgås med link, store bogstaver eller anden HOME
if [ "$(id -un)" = "casperkloster" ]; then
  H="$S/h13"; mkdir -p "$H/.claude"; echo '{"x":1}' > "$H/.claude/settings.json"; ln -s "$H/.claude" "$S/link13"
  koer "$S/link13" "$H"; ok "13 link til ~/.claude røres ikke" '[ "$(cat "$H/.claude/settings.json")" = "{\"x\":1}" ]'
  koer "$H/.CLAUDE" "$H"; ok "13 .CLAUDE røres ikke" '[ "$(cat "$H/.claude/settings.json")" = "{\"x\":1}" ]'
  koer "$H/.claude/under" "$H"; ok "13 mappe inde i ~/.claude røres ikke" '[ ! -e "$H/.claude/under/settings.json" ]'
  # Rigtig hjemmemappe fra brugerdatabasen, mens HOME er noget andet (kun simuleret: skriv aldrig i den rigtige)
  ok "13 rigtig ~/.claude genkendes med anden HOME" '[ "$(HOME="$S/andet" node -e "import(\"$(dirname "$O")/../sikkerhed/regler.mjs\").then(m=>console.log(m.erCaspersOpsaetning(\"$(id -P | cut -d: -f9)/.claude\")))")" = true ]'
fi

# 14) Automatisk opdatering slås til for Alekos' GitHub-markedsplads — men aldrig for en anden kilde
K="$S/k14"; mkdir -p "$K"
printf '%s' '{"extraKnownMarketplaces":{"alekos-intern":{"source":{"source":"github","repo":"CasperAlekosDK/alekos-claude-plugin"}},"andet":{"source":{"source":"github","repo":"x/y"}}}}' > "$K/settings.json"; koer "$K" "$S/h14"
ok "14 autoUpdate på Alekos" '[ "$(felt "$K/settings.json" "d[\"extraKnownMarketplaces\"][\"alekos-intern\"][\"autoUpdate\"]")" = True ]'
ok "14 ikke på andre" '[ "$(felt "$K/settings.json" "\"autoUpdate\" in d[\"extraKnownMarketplaces\"][\"andet\"]")" = False ]'
printf '%s' '{"extraKnownMarketplaces":{"alekos-intern":{"source":{"source":"github","repo":"angriber/falsk"}}}}' > "$K/settings.json"; koer "$K" "$S/h14"
ok "14 ikke på falsk repo med samme navn" '[ "$(felt "$K/settings.json" "\"autoUpdate\" in d[\"extraKnownMarketplaces\"][\"alekos-intern\"]")" = False ]'

# 15) Baggrundsopdatering: hooken startes af et program ved navn "claude" (her en kopi af node, så "claude plugin …"
#     kører scriptet "plugin" i opsætningsmappen — det beviser også, at kommandoen kører dér og ikke i projektmappen)
export NODE_BIN="$(command -v node)"; mkdir -p "$S/bin" "$S/lib"; NODE="$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$(command -v node)")"
cp "$NODE" "$S/bin/claude"; cp "$NODE" "$S/bin/node-agtig"; cp "$(dirname "$NODE")"/../lib/libnode.*.dylib "$S/lib/" 2>/dev/null || true
K="$S/k15"; mkdir -p "$K/plugins"
printf 'const fs=require("fs");fs.appendFileSync(%s,process.argv.slice(2).join(" ")+"\\n");fs.appendFileSync(%s,fs.realpathSync(process.cwd())+"\\n");\n' "'$S/kald.log'" "'$S/cwd.log'" > "$K/plugin"
gh(){ printf '%s' "{\"alekos-intern\":{\"source\":{\"source\":\"$1\",\"repo\":\"$2\",\"path\":\"/x\"}}}" > "$K/plugins/known_marketplaces.json"; }
start(){ rm -f "$S/kald.log" "$S/cwd.log"; HOME="$S/h15" CLAUDE_CONFIG_DIR="$K" "$1" -e 'require("child_process").spawnSync(process.env.NODE_BIN,[process.argv[1]],{stdio:["ignore","ignore","inherit"]})' "$O"; for i in 1 2 3 4 5 6 7 8 9 10; do [ -s "$S/kald.log" ] && break; sleep 0.2; done; }
gh github CasperAlekosDK/alekos-claude-plugin; start "$S/bin/claude"
ok "15 opdaterer markedspladsen og pluginet" 'grep -q "^marketplace update alekos-intern$" "$S/kald.log" && grep -q "^update alekos@alekos-intern$" "$S/kald.log"'
ok "15 kører i opsætningsmappen" '[ "$(head -1 "$S/cwd.log")" = "$(cd "$K" && pwd -P)" ]'
ok "15 låsen fjernes bagefter" 'for i in 1 2 3 4 5; do [ -e "$K/.alekos-opdaterer.laas" ] || break; sleep 0.2; done; [ ! -e "$K/.alekos-opdaterer.laas" ]'
start "$S/bin/claude"; sleep 0.5
ok "15 højst én gang i timen" '[ ! -e "$S/kald.log" ]'
rm -f "$K/.alekos-opdateret"; rm -f "$S/kald.log"; HOME="$S/h15" CLAUDE_CONFIG_DIR="$K" ALEKOS_OPDATERER=1 "$S/bin/claude" -e 'require("child_process").spawnSync(process.env.NODE_BIN,[process.argv[1]],{stdio:"ignore"})' "$O"; sleep 1
ok "15 aldrig fra den proces, den selv startede" '[ ! -e "$S/kald.log" ]'
rm -f "$K/.alekos-opdateret"; gh directory x; start "$S/bin/claude"; sleep 0.5
ok "15 ikke for en lokal mappe (Caspers test)" '[ ! -e "$S/kald.log" ]'
gh github angriber/falsk; start "$S/bin/claude"; sleep 0.5
ok "15 ikke for et falsk repo" '[ ! -e "$S/kald.log" ]'
# 16) Kun et program, der hedder claude; ingen variabel kan pege et andet sted hen; mærkefil som link; lås
gh github CasperAlekosDK/alekos-claude-plugin; start "$S/bin/node-agtig"; sleep 0.5
ok "16 ikke et program med et andet navn" '[ ! -e "$S/kald.log" ]'
rm -f "$S/kald.log"; HOME="$S/h15" CLAUDE_CONFIG_DIR="$K" CLAUDE_CODE_EXECPATH="$S/bin/claude" node "$O" >/dev/null; sleep 1
ok "16 CLAUDE_CODE_EXECPATH bruges ikke" '[ ! -e "$S/kald.log" ]'
echo hemmelig > "$S/maal"; ln -s "$S/maal" "$K/.alekos-opdateret"; start "$S/bin/claude"; sleep 0.5
ok "16 mærkefil som link: målet urørt, ingen opdatering" '[ "$(cat "$S/maal")" = hemmelig ] && [ ! -e "$S/kald.log" ]'
rm -f "$K/.alekos-opdateret"; mkdir "$K/.alekos-opdaterer.laas"; start "$S/bin/claude"; sleep 0.5
ok "16 lås holdt: ingen anden opdatering" '[ ! -e "$S/kald.log" ]'
rmdir "$K/.alekos-opdaterer.laas"

rm -rf "$S"
echo "bestået $pass, fejl $fail"
[ "$fail" = 0 ]
