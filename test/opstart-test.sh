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
# Ingen besked til personen (0.7.2: svaret har altid udgavelinjen til Claude, men ingen systemMessage).
ingen_besked(){ printf "%s" "$out" | python3 -c 'import json,sys;d=json.load(sys.stdin);sys.exit(0 if "systemMessage" not in d and d["hookSpecificOutput"]["additionalContext"].startswith("Alekos-pluginet kører udgave ") else 1)'; }
nb(){ ls "$1" 2>/dev/null | grep -c '^settings.json.alekos-backup-' ; }
# Kører en kommando som forældreløs (forælder = launchd), så hooken ALDRIG finder et rigtigt Claude Code-program blandt
# forfædrene (testen kan selv være startet fra Claude Code — så ville den rigtige claude blive kaldt). Venter ikke.
uden_claude(){ python3 -c 'import os,sys,time
if os.fork()==0:
    if os.fork()==0:
        while os.getppid()!=1: time.sleep(0.01)
        os.execvp(sys.argv[1],sys.argv[1:])
    os._exit(0)
os.wait()' "$@"; }

# 1) Tom opsætning: reglerne sættes, besked vises, ingen backup (der var ingen fil)
K="$S/k1"; mkdir -p "$K"; koer "$K" "$S/h1"
ok "1 exit 0" '[ $rc = 0 ]'
ok "1 sandkasse slået til" '[ "$(felt "$K/settings.json" "d[\"sandbox\"][\"enabled\"]")" = True ]'
ok "1 gem_forslag spørger" '[ "$(felt "$K/settings.json" "\"mcp__plugin_alekos_alekos__gem_forslag\" in d[\"permissions\"][\"ask\"]")" = True ]'
ok "1 del_opskrift spørger (0.7.6)" '[ "$(felt "$K/settings.json" "\"mcp__plugin_alekos_alekos__del_opskrift\" in d[\"permissions\"][\"ask\"] and \"mcp__plugin_alekos_alekos__del_opskrift\" not in d[\"permissions\"][\"allow\"]")" = True ]'
ok "1 Supabase spærret" '[ "$(felt "$K/settings.json" "\"*.supabase.co\" in d[\"sandbox\"][\"network\"][\"deniedDomains\"]")" = True ]'
ok "1 testmappen er skrivebeskyttet" '[ "$(felt "$K/settings.json" "\"$K\" in d[\"sandbox\"][\"filesystem\"][\"denyWrite\"]")" = True ]'
ok "1 pluginets cache-mappe tilføjes ikke pr. version" '[ "$(felt "$K/settings.json" "any(\"plugins/cache\" in x for x in d[\"sandbox\"][\"filesystem\"][\"denyWrite\"])")" = False ]'
ok "1 OneDrive, Skrivebord, Overførsler og Dokumenter skrivbare for kommandoer" '[ "$(felt "$K/settings.json" "d[\"sandbox\"][\"filesystem\"][\"allowWrite\"] == [\"~/Library/CloudStorage/OneDrive-*/**/*\",\"~/Desktop/**/*\",\"~/Downloads/**/*\",\"~/Documents/**/*\"]")" = True ]'
ok "1 0.7.0: kommandoer må køre uden sandkasse efter ja" '[ "$(felt "$K/settings.json" "d[\"sandbox\"][\"allowUnsandboxedCommands\"]")" = True ]'
ok "1 0.7.0: open/osascript ikke spærret" '[ "$(felt "$K/settings.json" "any(\"open\" in x or \"osascript\" in x for x in d[\"permissions\"][\"deny\"])")" = False ]'
ok "1 0.7.0: spring-godkendelser-over ikke spærret" '[ "$(felt "$K/settings.json" "\"disableBypassPermissionsMode\" in d[\"permissions\"]")" = False ]'
ok "1 0.7.4: Overførsler/Skrivebord/Dokumenter er arbejdsmapper (Chrome-upload)" '[ "$(felt "$K/settings.json" "d[\"permissions\"][\"additionalDirectories\"] == [\"$S/h1/Downloads\",\"$S/h1/Desktop\",\"$S/h1/Documents\"]")" = True ]'
ok "1 OneDrive skrivbar for Edit/Write" '[ "$(felt "$K/settings.json" "\"Edit(~/Library/CloudStorage/OneDrive-*/**)\" in d[\"permissions\"][\"allow\"]")" = True ]'
ok "1 OneDrive læsbar for Read" '[ "$(felt "$K/settings.json" "\"Read(~/Library/CloudStorage/OneDrive-*/**)\" in d[\"permissions\"][\"allow\"]")" = True ]'
ok "1 selve .git spærret i OneDrive/Skrivebord/Overførsler/Dokumenter" '[ "$(felt "$K/settings.json" "all(x in d[\"sandbox\"][\"filesystem\"][\"denyWrite\"] for x in (\"~/Library/CloudStorage/OneDrive-*/**/.git\",\"~/Downloads/.git\",\"~/Downloads/**/.git\",\"~/Desktop/**/.git\",\"~/Documents/**/.git\"))")" = True ]'
ok "1 opsætningsfiler i OneDrive spærret" '[ "$(felt "$K/settings.json" "all(\"~/Library/CloudStorage/OneDrive-*/**/\"+f in d[\"sandbox\"][\"filesystem\"][\"denyWrite\"] for f in (\".claude/**\",\".mcp.json\",\".git/hooks/**\",\".vscode/**\"))")" = True ]'
ok "1 Alekos-MCP spørger ikke" '[ "$(felt "$K/settings.json" "\"mcp__plugin_alekos_alekos__*\" in d[\"permissions\"][\"allow\"]")" = True ]'
ok "1 Chrome spørger ikke" '[ "$(felt "$K/settings.json" "\"mcp__claude-in-chrome__*\" in d[\"permissions\"][\"allow\"]")" = True ]'
ok "1 gem_forslag spørger stadig (ask vinder)" '[ "$(felt "$K/settings.json" "\"mcp__plugin_alekos_alekos__gem_forslag\" in d[\"permissions\"][\"ask\"] and \"mcp__plugin_alekos_alekos__gem_forslag\" not in d[\"permissions\"][\"allow\"]")" = True ]'
ok "1 besked om genstart" 'printf "%s" "$out" | grep -q "er sat"'
ok "1 ingen backup uden fil" '[ "$(nb "$K")" = 0 ]'

# 2) Igen: intet ændres, ingen besked, ingen backup (idempotent)
h1="$(shasum "$K/settings.json")"; koer "$K" "$S/h1"
ok "2 uændret" '[ "$(shasum "$K/settings.json")" = "$h1" ]'
ok "2 ingen besked" 'ingen_besked'
ok "2 ingen backup" '[ "$(nb "$K")" = 0 ]'

# 3) Eksisterende indstillinger: bevares, excludedCommands og bypass fjernes, backup tages
K="$S/k3"; mkdir -p "$K"
printf '%s' '{"model":"opus","permissions":{"allow":["Bash(git *)","mcp__plugin_alekos_alekos__gem_forslag"],"defaultMode":"bypassPermissions"},"sandbox":{"excludedCommands":["docker"]},"enabledPlugins":{"alekos@alekos-intern":true}}' > "$K/settings.json"
foer="$(cat "$K/settings.json")"; koer "$K" "$S/h3"
ok "3 model bevaret" '[ "$(felt "$K/settings.json" "d[\"model\"]")" = opus ]'
ok "3 egen allow bevaret" '[ "$(felt "$K/settings.json" "\"Bash(git *)\" in d[\"permissions\"][\"allow\"]")" = True ]'
ok "3 allow på gem fjernet" '[ "$(felt "$K/settings.json" "\"mcp__plugin_alekos_alekos__gem_forslag\" in d[\"permissions\"][\"allow\"]")" = False ]'
ok "3 0.7.0: medarbejderens egen standardtilstand bevares" '[ "$(felt "$K/settings.json" "d[\"permissions\"][\"defaultMode\"]")" = bypassPermissions ]'
K0="$S/k3b"; mkdir -p "$K0"; printf '%s' '{"permissions":{"deny":["Bash(open *)","Bash(osascript *)","Bash(git push *)"],"disableBypassPermissionsMode":"disable"},"sandbox":{"allowUnsandboxedCommands":false}}' > "$K0/settings.json"; koer "$K0" "$S/h3b"
ok "3b 0.6-spærringer fjernes ved opdatering, egne regler bevares" '[ "$(felt "$K0/settings.json" "(\"Bash(open *)\" not in d[\"permissions\"][\"deny\"]) and (\"Bash(git push *)\" in d[\"permissions\"][\"deny\"]) and (\"disableBypassPermissionsMode\" not in d[\"permissions\"]) and d[\"sandbox\"][\"allowUnsandboxedCommands\"]")" = True ]'
ok "3 excludedCommands fjernet" '[ "$(felt "$K/settings.json" "\"excludedCommands\" in d[\"sandbox\"]")" = False ]'
ok "3 plugins bevaret" '[ "$(felt "$K/settings.json" "d[\"enabledPlugins\"][\"alekos@alekos-intern\"]")" = True ]'
ok "3 én backup med det gamle indhold" '[ "$(nb "$K")" = 1 ] && [ "$(cat "$K"/settings.json.alekos-backup-*)" = "$foer" ]'
ok "3 besked" 'printf "%s" "$out" | grep -q "Alekos: sikkerhedsreglerne"'
koer "$K" "$S/h3"; ok "3b anden kørsel uændret" 'ingen_besked && [ "$(nb "$K")" = 1 ]'

# 3c) Gammelt Chrome-forbud fra 0.2-0.3: fjernes fra deny, men Chrome tillades
K="$S/k3c"; mkdir -p "$K"
printf '%s' '{"permissions":{"deny":["mcp__claude-in-chrome__*"]}}' > "$K/settings.json"; koer "$K" "$S/h3c"
ok "3c Chrome-forbud fjernet" '[ "$(felt "$K/settings.json" "\"mcp__claude-in-chrome__*\" in d[\"permissions\"][\"deny\"]")" = False ]'
ok "3c Chrome tilladt" '[ "$(felt "$K/settings.json" "\"mcp__claude-in-chrome__*\" in d[\"permissions\"][\"allow\"]")" = True ]'
koer "$K" "$S/h3c"; ok "3c anden kørsel uændret" 'ingen_besked'

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
  ok "7 ingen besked, ingen backup" 'ingen_besked && [ "$(nb "$H/.claude")" = 0 ]'
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
start(){ rm -f "$S/kald.log" "$S/cwd.log"; HOME="$S/h15" CLAUDE_CONFIG_DIR="$K" "$1" -e 'require("child_process").spawnSync(process.env.NODE_BIN,[process.argv[1]],{stdio:["ignore","ignore","inherit"]})' "$O"; for i in $(seq 1 15); do [ -s "$S/kald.log" ] && { sleep 1; break; }; sleep 0.2; done; }
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
rm -f "$S/kald.log"; HOME="$S/h15" CLAUDE_CONFIG_DIR="$K" CLAUDE_CODE_EXECPATH="$S/bin/claude" uden_claude node "$O" >/dev/null; sleep 1.5
ok "16 CLAUDE_CODE_EXECPATH bruges ikke" '[ ! -e "$S/kald.log" ]'
echo hemmelig > "$S/maal"; rm -f "$K/.alekos-opdateret"; ln -s "$S/maal" "$K/.alekos-opdateret"; touch -h -t 202001010000 "$K/.alekos-opdateret"; ok "16 linket findes" '[ -L "$K/.alekos-opdateret" ]'; start "$S/bin/claude"; sleep 0.5
ok "16 mærkefil som link: målet urørt, ingen opdatering" '[ "$(cat "$S/maal")" = hemmelig ] && [ ! -e "$S/kald.log" ]'
rm -f "$K/.alekos-opdateret"; mkdir "$K/.alekos-opdaterer.laas"; start "$S/bin/claude"; sleep 0.5
ok "16 lås holdt: ingen anden opdatering" '[ ! -e "$S/kald.log" ]'
rmdir "$K/.alekos-opdaterer.laas"

# 17) 0.7.2: Claude får altid den kørende udgave; besked + udgave er ét gyldigt JSON-svar
V="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$(dirname "$O")/../.claude-plugin/plugin.json")"
K="$S/k17"; mkdir -p "$K"; koer "$K" "$S/h17"
ok "17 første start: ét JSON-svar med besked OG udgave" 'printf "%s" "$out" | python3 -c "import json,sys;d=json.load(sys.stdin);c=d[\"hookSpecificOutput\"][\"additionalContext\"];sys.exit(0 if \"er sat\" in d[\"systemMessage\"] and \"Alekos-pluginet kører udgave $V \" in c and c.startswith(\"Besked fra Alekos-pluginet\") else 1)"'
koer "$K" "$S/h17"
ok "17 anden start: kun udgaven til Claude, ingen besked til personen" 'ingen_besked && printf "%s" "$out" | grep -q "kører udgave $V "'
ok "17 udgaven er den i plugin.json (x.y.z)" 'printf "%s" "$V" | grep -Eq "^[0-9]+\.[0-9]+\.[0-9]+$"'

# 18) 0.8.0: ret_fagviden spørger som del_opskrift; skrivende værktøjer spørger også under andre mulige servernavne, men
#     allow udvides ALDRIG til andre navne; org-synkens mappe er skrivebeskyttet for kommandoer
K="$S/k18"; mkdir -p "$K"; printf '%s' '{"permissions":{"allow":["mcp__plugin_alekos_alekos__ret_fagviden","mcp__plugin_alekos-synced_alekos__gem_forslag"]}}' > "$K/settings.json"; koer "$K" "$S/h18"
ok "18 ret_fagviden spørger og står ikke i allow" '[ "$(felt "$K/settings.json" "\"mcp__plugin_alekos_alekos__ret_fagviden\" in d[\"permissions\"][\"ask\"] and \"mcp__plugin_alekos_alekos__ret_fagviden\" not in d[\"permissions\"][\"allow\"]")" = True ]'
ok "18 gem/del/ret spørger under andre mulige navne" '[ "$(felt "$K/settings.json" "all(p+v in d[\"permissions\"][\"ask\"] for p in (\"mcp__plugin_alekos-synced_alekos__\",\"mcp__plugin_alekos_synced_alekos__\",\"mcp__plugin_synced_alekos_alekos__\") for v in (\"gem_forslag\",\"del_opskrift\",\"ret_fagviden\"))")" = True ]'
ok "18 allow kun med Alekos-reglen (ingen andre plugin-navne), alt-gem fjernet fra allow" '[ "$(felt "$K/settings.json" "[x for x in d[\"permissions\"][\"allow\"] if x.startswith(\"mcp__plugin\")] == [\"mcp__plugin_alekos_alekos__*\"]")" = True ]'
ok "18 org-synkens mappe i denyWrite" '[ "$(felt "$K/settings.json" "\"~/.claude/plugins/synced\" in d[\"sandbox\"][\"filesystem\"][\"denyWrite\"] and \"$K/plugins/synced\" in d[\"sandbox\"][\"filesystem\"][\"denyWrite\"]")" = True ]'

# 19-24) 0.8.0: overgang til org-synk — INGEN automatisk afinstallering (kontrolfund 07.11.2026: den synkede kopis hooks kører
#     ikke, mens markedsplads-kopien er installeret, så intet kan bevise, at vagten tager over). Kun en besked med kommandoen.
#     Falsk "claude" (kopi af node) kører scriptet "plugin" i opsætningsmappen og logger kaldet.
skript(){ printf 'const fs=require("fs");fs.appendFileSync(%s,process.argv.slice(2).join(" ")+"\\n");\n' "'$S/kald.log'" > "$1/plugin"; }
synket(){ # $1 = K, $2 = version, $3 = navn (standard alekos), $4 = tom-vagt | fremmed-vagt | uden-hookref | uden-in-use | uden-manifest
  # Opbygning som på Caspers Mac (07.11.2026): synced/<org>_<spand>/{.last-complete-round,manifest.json,<mappe>/.in_use}
  local b="$1/plugins/synced/orgx_spand1" d; d="$b/pl-uuid1"; mkdir -p "$d/.claude-plugin" "$d/hooks" "$d/.in_use"; : > "$1/plugins/synced/.bucket-orgx_spand1"
  echo rundeid > "$b/.last-complete-round"; printf '{"plugins":[{"name":"pl-uuid1","version":"0001"}]}' > "$b/manifest.json"
  printf '{"name":"%s","version":"%s"}' "${3:-alekos}" "$2" > "$d/.claude-plugin/plugin.json"
  if [ "${4:-}" = uden-hookref ]; then echo '{"hooks":{}}' > "$d/hooks/hooks.json"; else cp "$(dirname "$O")/hooks.json" "$d/hooks/hooks.json"; fi
  case "${4:-}" in tom-vagt) : > "$d/hooks/vagt.mjs";; fremmed-vagt) echo 'process.exit(0)' > "$d/hooks/vagt.mjs";; *) cp "$(dirname "$O")/vagt.mjs" "$d/hooks/vagt.mjs";; esac
  [ "${4:-}" = uden-in-use ] && rmdir "$d/.in_use"
  [ "${4:-}" = uden-manifest ] && printf '{"plugins":[]}' > "$b/manifest.json"
  return 0; }
kontakt(){ # $1 = K, $2 = værdi af org_synk_overgang som JSON ("" = feltet mangler)
  python3 -c 'import json,sys;r={"regler":[],"ukendt_tilladt":True,"altid_spaerret":"x"}
if sys.argv[2]: r["org_synk_overgang"]=json.loads(sys.argv[2])
json.dump({"sidste":"p1","personer":{"p1":{"hentet":0,"regler":r}}},open(sys.argv[1]+"/alekos-forbindelser.json","w"))' "$1" "$2"; }
ny(){ # $1 = navn: frisk opsætning med Alekos' GitHub-markedsplads og regler sat
  K="$S/$1"; rm -rf "$K"; mkdir -p "$K/plugins/cache/alekos-intern/alekos/0.7.6"; skript "$K"
  printf '%s' '{"alekos-intern":{"source":{"source":"github","repo":"CasperAlekosDK/alekos-claude-plugin"}}}' > "$K/plugins/known_marketplaces.json"
  kontakt "$K" true; HOME="$S/h19" CLAUDE_CONFIG_DIR="$K" CLAUDE_PLUGIN_ROOT="$K/plugins/cache/alekos-intern/alekos/0.7.6" ALEKOS_OPDATERER=1 node "$O" >/dev/null; }
mstart(){ # $1 = CLAUDE_PLUGIN_ROOT; startet af den falske claude; hookens svar i $out
  rm -f "$S/kald.log"
  out="$(HOME="$S/h19" CLAUDE_CONFIG_DIR="$K" CLAUDE_PLUGIN_ROOT="$1" "$S/bin/claude" -e 'const r=require("child_process").spawnSync(process.env.NODE_BIN,[process.argv[1]],{stdio:["ignore","pipe","inherit"]});process.stdout.write(r.stdout)' "$O")"
  for i in $(seq 1 12); do [ -s "$S/kald.log" ] && { sleep 1; break; }; sleep 0.2; done; }
hstart(){ out="$(HOME="$S/h19" CLAUDE_CONFIG_DIR="$K" CLAUDE_PLUGIN_ROOT="$1" ALEKOS_OPDATERER=1 node "$O")"; } # uden baggrundskørsel
CACHE(){ printf '%s' "$K/plugins/cache/alekos-intern/alekos/0.7.6"; }
SYNK(){ printf '%s' "$K/plugins/synced/orgx_spand1/pl-uuid1"; }
klar(){ printf "%s" "$out" | grep -q "org-synk er klar"; }

# 19) Markedsplads-kopi + gyldig synket kopi: besked med kommandoen — men intet afinstalleres og intet i opsætningen ændres
ny k19; synket "$K" 0.8.0; foer="$(shasum "$K/settings.json" "$K/plugins/known_marketplaces.json")"; mstart "$(CACHE)"
ok "19 ingen automatisk afinstallering" '! grep -q "uninstall\|remove" "$S/kald.log" 2>/dev/null'
ok "19 besked til medarbejderen med kommandoen" 'printf "%s" "$out" | python3 -c "import json,sys;d=json.load(sys.stdin);sys.exit(0 if \"/plugin uninstall alekos@alekos-intern\" in d[\"systemMessage\"] and \"kører nu via org-synk\" in d[\"systemMessage\"] else 1)"'
ok "19 markedspladsen bevares (kun plugin uninstall i beskeden)" '! printf "%s" "$out" | grep -q "marketplace remove"'
ok "19 settings.json og markedspladsen urørt" '[ "$(shasum "$K/settings.json" "$K/plugins/known_marketplaces.json")" = "$foer" ]'
ok "19 almindelig opdatering kører stadig" 'grep -qx "update alekos@alekos-intern" "$S/kald.log"'

# 20) Kører som den synkede kopi: ingen opdatering fra GitHub, regler sættes, bekræftelse én gang pr. udgave
ny k20; synket "$K" 0.8.0; rm "$K/settings.json"; mstart "$(SYNK)"
ok "20 ingen kald (hverken opdatering eller afinstallering)" '[ ! -e "$S/kald.log" ]'
ok "20 reglerne sat" '[ "$(felt "$K/settings.json" "d[\"sandbox\"][\"enabled\"] and \"mcp__plugin_alekos_alekos__ret_fagviden\" in d[\"permissions\"][\"ask\"]")" = True ]'
ok "20 bekræftelse til medarbejderen + råd om den gamle markedsplads" 'printf "%s" "$out" | python3 -c "import json,sys;d=json.load(sys.stdin);m=d[\"systemMessage\"];sys.exit(0 if \"kører nu via org-synk\" in m and \"/plugin marketplace remove alekos-intern\" in m else 1)"'
ok "20 Claude får at vide, at det er org-synk (værktøjsnavnet skal meldes)" 'printf "%s" "$out" | grep -q "org-synk (alekos@synced)"'
hstart "$(SYNK)"; ok "20 anden start: ingen besked til personen" 'ingen_besked'
ok "20 aldrig 'org-synk er klar' fra den synkede kopi" '! klar'
hstart "$(CACHE)"; ok "20 markedsplads-kopien nævner ikke alekos@synced" '! printf "%s" "$out" | grep -q "alekos@synced)"'

# 21) Ingen besked uden en gyldig synket kopi (navn, udgave ≥ egen og ≥ 0.8.0, Alekos' vagt med i hooks)
ny k21; hstart "$(CACHE)"; ok "21 ingen synket kopi" '! klar'
for v in "0.7.9" "0.8" "x.y.z" "0.7.99"; do ny k21v; synket "$K" "$v"; hstart "$(CACHE)"; ok "21 synket $v for gammel/ugyldig" '! klar'; done
ny k21n; synket "$K" 0.8.0 andet-plugin; hstart "$(CACHE)"; ok "21 andet plugin-navn" '! klar'
ny k21t; synket "$K" 0.8.0 alekos tom-vagt; hstart "$(CACHE)"; ok "21 tom vagt.mjs" '! klar'
ny k21f; synket "$K" 99.0.0 alekos fremmed-vagt; hstart "$(CACHE)"; ok "21 fremmed vagt.mjs (selv med udgave 99.0.0)" '! klar'
ny k21r; synket "$K" 0.8.0 alekos uden-hookref; hstart "$(CACHE)"; ok "21 hooks.json uden vagten" '! klar'
ny k21l; synket "$K" 0.8.0; mkdir -p "$S/udenfor"; mv "$K/plugins/synced" "$S/udenfor/s21"; ln -s "$S/udenfor/s21" "$K/plugins/synced"; hstart "$(CACHE)"
ok "21 synced som genvej (link) tæller ikke" '! klar'
ny k21d; synket "$K" 0.8.0; hstart "$S/lokal-kildemappe/plugins/alekos"; ok "21 lokal mappe (ikke markedspladsens cache)" '! klar'
ny k21g; synket "$K" 0.8.0; printf '%s' '{"alekos-intern":{"source":{"source":"directory","path":"/x"}}}' > "$K/plugins/known_marketplaces.json"; hstart "$(CACHE)"
ok "21 markedsplads fra lokal mappe (Caspers test)" '! klar'
ny k21x; synket "$K" 0.8.0; printf '%s' '{"alekos-intern":{"source":{"source":"github","repo":"angriber/alekos-claude-plugin"}}}' > "$K/plugins/known_marketplaces.json"; hstart "$(CACHE)"
ok "21 falsk repo" '! klar'
ny k21i; synket "$K" 0.8.0 alekos uden-in-use; hstart "$(CACHE)"; ok "21 kopi uden .in_use" '! klar'
ny k21m; synket "$K" 0.8.0 alekos uden-manifest; hstart "$(CACHE)"; ok "21 kopi, der ikke står i manifestet" '! klar'
ny k21s; synket "$K" 0.8.0; mv "$K/plugins/synced/orgx_spand1" "$K/plugins/synced/orgx_spand0"; touch -t 202001010000 "$K/plugins/synced/orgx_spand0/.last-complete-round"
mkdir -p "$K/plugins/synced/orgx_spand2"; echo r > "$K/plugins/synced/orgx_spand2/.last-complete-round"; hstart "$(CACHE)"
ok "21 gammel spand tæller ikke, når en nyere synk-runde findes" '! klar'
ny k21b; mkdir -p "$K/plugins/synced"; synket "$K" 0.8.0; mv "$K/plugins/synced/orgx_spand1" "$K/plugins/synced/.bucket-skjult"; hstart "$(CACHE)"
ok "21 skjulte mapper tæller ikke" '! klar'
# Caspers kontakt på serveren (org_synk_overgang): standard fra — mangler, false, "true" som tekst eller ingen cache = ingen besked
for v in "" false '"true"' 1; do ny k21k; synket "$K" 0.8.0; kontakt "$K" "$v"; hstart "$(CACHE)"; ok "21 kontakten ${v:-mangler}: ingen besked" '! klar'; done
ny k21c; synket "$K" 0.8.0; rm "$K/alekos-forbindelser.json"; hstart "$(CACHE)"; ok "21 ingen regler fra serveren: ingen besked" '! klar'
ny k21o; synket "$K" 0.8.0; hstart "$(CACHE)"; ok "21 gyldig kopi + kontakten til giver beskeden (kontrol)" 'klar'
hstart "$(CACHE)"; ok "21 højst én gang i døgnet (ingen løkke)" '! klar'
touch -t 202001010000 "$K/.alekos-synk-klar"; hstart "$(CACHE)"; ok "21 igen efter et døgn" 'klar'

# 23) Caspers egen opsætning: ingen besked, intet kaldt
if [ "$(id -un)" = "casperkloster" ]; then
  H="$S/h23"; K="$H/.claude"; mkdir -p "$K/plugins/cache/alekos-intern/alekos/0.7.6"; skript "$K"; synket "$K" 0.8.0; kontakt "$K" true; echo '{"x":1}' > "$K/settings.json"
  printf '%s' '{"alekos-intern":{"source":{"source":"github","repo":"CasperAlekosDK/alekos-claude-plugin"}}}' > "$K/plugins/known_marketplaces.json"
  rm -f "$S/kald.log"; out="$(HOME="$H" CLAUDE_CONFIG_DIR= CLAUDE_PLUGIN_ROOT="$K/plugins/cache/alekos-intern/alekos/0.7.6" "$S/bin/claude" -e 'const r=require("child_process").spawnSync(process.env.NODE_BIN,[process.argv[1]],{stdio:["ignore","pipe","ignore"]});process.stdout.write(r.stdout)' "$O")"; sleep 1.5
  ok "23 Caspers opsætning: ingen besked, intet kaldt, settings urørt" 'ingen_besked && [ ! -e "$S/kald.log" ] && [ "$(cat "$K/settings.json")" = "{\"x\":1}" ]'
fi

# 24) Ny ejer af repoet (GitHub-organisation): tilføjes kun i GITHUB_REPOS — så virker opdatering, besked og autoUpdate
KOPI="$S/kopi"; cp -R "$(dirname "$O")/.." "$KOPI"
python3 - "$KOPI/sikkerhed/regler.mjs" <<'PY'
import sys;f=sys.argv[1];s=open(f).read();a='export const GITHUB_REPOS = [GITHUB_REPO];'
assert a in s;open(f,'w').write(s.replace(a,'export const GITHUB_REPOS = [GITHUB_REPO, "AlekosOrg/alekos-claude-plugin"];'))
PY
O_GL="$O"; O="$KOPI/hooks/opstart.mjs"
ny k24; printf '%s' '{"alekos-intern":{"source":{"source":"github","repo":"alekosorg/Alekos-Claude-Plugin"}}}' > "$K/plugins/known_marketplaces.json"; synket "$K" 0.8.0; mstart "$(CACHE)"
ok "24 ny ejer: opdatering hentes" 'grep -qx "update alekos@alekos-intern" "$S/kald.log"'
ok "24 ny ejer: besked om org-synk" 'klar'
printf '%s' '{"extraKnownMarketplaces":{"alekos-intern":{"source":{"source":"github","repo":"AlekosOrg/alekos-claude-plugin"}}}}' > "$K/settings.json"; HOME="$S/h24" CLAUDE_CONFIG_DIR="$K" ALEKOS_OPDATERER=1 node "$O" >/dev/null
ok "24 ny ejer: autoUpdate slås til" '[ "$(felt "$K/settings.json" "d[\"extraKnownMarketplaces\"][\"alekos-intern\"].get(\"autoUpdate\")")" = True ]'
O="$O_GL"; ny k24c; printf '%s' '{"alekos-intern":{"source":{"source":"github","repo":"AlekosOrg/alekos-claude-plugin"}}}' > "$K/plugins/known_marketplaces.json"; synket "$K" 0.8.0; mstart "$(CACHE)"
ok "24 uden for listen: ingen opdatering, ingen besked" '[ ! -e "$S/kald.log" ] && ! klar'

rm -rf "$S"
echo "bestået $pass, fejl $fail"
[ "$fail" = 0 ]
