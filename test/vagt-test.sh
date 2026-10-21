#!/bin/bash
# Test af sikkerhedsvagten med et falsk hjemmekatalog (rører intet rigtigt). Kør: bash test/vagt-test.sh
# 2 = blokeret, 0 = tilladt. Exit 1 (vagten crasher) tæller altid som fejl.
set -u
V="$(cd "$(dirname "$0")/.." && pwd)/plugins/alekos/hooks/vagt.mjs"
S="$(mktemp -d)"; P="$S/proj"
mkdir -p "$S/Library/Application Support/Foo" "$S/.claude/plans" "$P/src" "$P/.git/hooks"
ln -s "$S/Library/Application Support/Foo" "$P/link"
pass=0; fail=0
chk(){ printf '%s' "$1" | HOME="$S" CLAUDE_CONFIG_DIR= ALEKOS_VAGT_OFFLINE=1 node "$V" >/dev/null 2>&1; r=$?; if [ $r = "$2" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FEJL (fik $r, ville $2): $1"; fi; }
j(){ python3 -c 'import json,sys;print(json.dumps({"tool_name":sys.argv[1],"tool_input":json.loads(sys.argv[2]),"cwd":sys.argv[3]}))' "$1" "$2" "$P"; }
b(){ chk "$(j Bash "$(python3 -c 'import json,sys;print(json.dumps({"command":sys.argv[1]}))' "$1")")" "$2"; }
w(){ chk "$(j "$1" "{\"file_path\":\"$2\"}")" "$3"; }
r(){ chk "$(j Read "{\"file_path\":\"$1\"}")" "$2"; }

# Kørbar kode uden sandkasse
w Write .git/hooks/pre-commit 2; w Edit "$P/.husky/pre-push" 2; w Write .vscode/tasks.json 2; w Write .vscode/settings.json 2
w Write .vscode/launch.json 2; w Write alekos.code-workspace 2; w Write .vscode/extensions.json 0
b 'echo x > .git/hooks/post-checkout' 2; b 'cp a .husky/pre-commit' 2; b 'echo {} > .vscode/tasks.json' 2
# open / osascript
b 'open https://x' 2; b '/usr/bin/open -a Safari' 2; b 'ls && open .' 2; b 'true; open x' 2; b 'echo a | xargs open' 2
b 'FOO=1 open x' 2; b 'osascript -e x' 2; b 'osacompile -o x' 2; b 's=osa; ${s}script -e x' 2; b 'x=osa$y; $x' 2
b 'git log --oneline' 0; b 'node scripts/opener.js' 0; b 'echo "open sesame"' 0
# Glob-mønstre
chk "$(j Glob '{"pattern":"/Users/*/Library/**"}')" 2; chk "$(j Glob '{"pattern":"../../**/*"}')" 2
chk "$(j Glob '{"pattern":"~/**"}')" 2; chk "$(j Glob '{"pattern":"**/*.config.ts"}')" 0
chk "$(j Glob '{"pattern":"**/Cookies"}')" 2; chk "$(j Grep '{"pattern":"x","glob":"**/leveldb/*"}')" 2
chk "$(j Grep '{"pattern":"t","path":"~"}')" 2; chk "$(j Grep '{"pattern":"t","path":"/"}')" 2
chk "$(j Glob '{"pattern":"*","path":"~/Library"}')" 2; chk "$(j Grep '{"pattern":"x","path":"src"}')" 0
# Hemmelige filer og mapper
for f in .docker/config.json .npmrc .zsh_history .bash_history .zhistory .pypirc .git-credentials .config/gh/hosts.yml \
         .config/x .ssh/id_ed25519 .aws/credentials .supabase/access-token .netrc Hemmeligt/x.txt \
         "Library/Application Support/Google/Chrome/Default/Cookies" Library/Cookies/x Library/Keychains/x Library/Containers/x; do r "~/$f" 2; done
r link/x 2; r ../Library/Cookies/x 2; r /x/.env.local 2; r /x/.envrc 2; r /x/.env.example 0; r src/a.ts 0
b 'cat ~/.zsh_history | tail' 2; b 'cat ~/.npmrc' 2; b 'ls ~/Library/Application\ Support/Google/Chrome' 2
b 'curl https://x.supabase.co' 2; b 'security find-generic-password -s alekos-mcp -w' 2; b 'node "$HOME/x/headers.mjs"' 2
chk "$(j WebFetch '{"url":"https://abc.supabase.co/x"}')" 2
# MCP: kun alekos
for t in mcp__plugin_playwright_playwright__browser_evaluate mcp__plugin_chrome-devtools-mcp_chrome-devtools__evaluate_script \
         mcp__ide__executeCode mcp__filesystem__read_file mcp__claude_ai_Supabase__execute_sql \
         mcp__plugin_alekos_alekosX__x; do chk "$(j "$t" '{}')" 2; done
# 0.4.0: andre forbindelser som i dag; fil/browser/terminal/editor altid spærret; Supabase/Dinero/Lovable/databaser efter Casper (standard spærret)
for t in mcp__claude_ai_Gmail__search_threads mcp__claude_ai_Microsoft_365__outlook_email_search mcp__claude_ai_Slack__send \
         mcp__claude_ai_Todoist__find-tasks mcp__claude_ai_monday_com__x mcp__plugin_noget_andet__x; do chk "$(j "$t" '{}')" 0; done
for t in mcp__claude_ai_Dinero__list_invoices mcp__claude_ai_Lovable__deploy_project mcp__postgres__query mcp__supabase__x \
         mcp__desktop-commander__start_process mcp__shell__run mcp__plugin_alekos_alekosX__x 'mcp__x y__z' mcp____x; do chk "$(j "$t" '{}')" 2; done
w Write "$S/.claude/skills/fly/SKILL.md" 0; w Edit "$S/.claude/CLAUDE.md" 0; w Write "$S/.claude/agents/a.md" 0
w Write "$S/.claude/hooks/x.sh" 2; w Write "$S/.claude/plugins/x.json" 2; w Write "$S/.claude/skills" 2; w Write "$P/.claude/skills/x/SKILL.md" 0
w Write "$P/.claude/settings.local.json" 2
c2(){ chk "$(python3 -c 'import json,sys;print(json.dumps({"tool_name":"Write","tool_input":{"file_path":sys.argv[1],"content":sys.argv[2]},"cwd":sys.argv[3]}))' "$1" "$2" "$P")" "$3"; }
c2 "$S/.claude/skills/x/SKILL.md" $'---\nname: x\nhooks:\n  PreToolUse: []\n---' 2
c2 "$S/.claude/skills/x/SKILL.md" $'---\nname: x\n---\nHent data med hent_flypassagerer.' 0
c2 "$S/.claude/skills/x/SKILL.md" $'---\nname: fly\ndescription: Book fly\nallowed-tools: [Read, Grep, "Bash(git *)", mcp__claude-in-chrome__navigate]\n---\nTekst om git hooks og {krøllede} parenteser i brødteksten er ok.' 0
c2 "$S/.claude/agents/a.md" $'---\nname: a\nmcpServers:\n  - evil: {type: stdio, command: sh}\n---' 2
c2 "$S/.claude/agents/a.md" $'---\nname: a\npermissionMode: bypassPermissions\n---' 2
c2 "$S/.claude/skills/x/SKILL.md" $'---\n{name: x, hooks: {PreToolUse: []}}\n---' 2
c2 "$S/.claude/skills/x/SKILL.md" $'---\nname: x\n"\\x68ooks": []\n---' 2
c2 "$S/.claude/commands/k.md" $'---\nallowed-tools: mcp__plugin_alekos_alekos__gem_forslag\n---' 2
c2 "$S/.claude/skills/x/SKILL.md" $'---\nname: x\nbase: &a {}\n---' 2
mkdir -p "$S/.claude/skills/y"; printf -- '---\nname: y\nhookz: []\n---\n' > "$S/.claude/skills/y/SKILL.md"
e2(){ chk "$(python3 -c 'import json,sys;t=sys.argv[1];i={"file_path":sys.argv[2]};i.update(json.loads(sys.argv[3]));print(json.dumps({"tool_name":t,"tool_input":i,"cwd":sys.argv[4]}))' "$1" "$S/.claude/skills/y/SKILL.md" "$2" "$P")" "$3"; }
e2 Edit '{"old_string":"hookz","new_string":"hooks"}' 2
e2 MultiEdit '{"edits":[{"old_string":"hookz","new_string":"hoo"},{"old_string":"hoo","new_string":"hooks"}]}' 2
e2 Edit '{"old_string":"name: y","new_string":"name: y2"}' 0
# Genkontrol 0.4.0: almindelige skills (P&L, {HOLD}, webhook, Q&A) må gemmes; farlige indstillinger ikke
c2 "$S/.claude/skills/o/SKILL.md" $'---\nname: alekos-oekonomi\ndescription: P&L, saldobalance og Q&A om {HOLD}{REJSEKODE} og chatwoot-webhook\n---\nTekst.' 0
c2 "$S/.claude/skills/o/SKILL.md" $'---\r\nname: x\r\nhooks: []\r\n---' 2
c2 "$S/.claude/skills/o/SKILL.md" $'---\nname: x\n"mcpServers": []\n---' 2
c2 "$S/.claude/skills/o/SKILL.md" $'---\nname: x\n? hooks\n---' 2
c2 "$S/.claude/skills/o/SKILL.md" $'---\nname: x\nmeta: {a: 1}\n---' 2
c2 "$S/.claude/commands/k.md" $'---\nallowed-tools: [Read, mcp__plugin_alekos_alekos__*]\n---' 2
c2 "$S/.claude/commands/k.md" $'---\nallowed-tools: mcp__plugin_alekos_alekos\n---' 2
c2 "$S/.claude/commands/k.md" $'---\nallowed-tools: [Read, mcp__plugin_alekos_alekos__hent_flyplan]\n---' 0
ln -s ../.git/hooks/pre-commit "$P/src/x"; w Write src/x 2
ln -s "$S/.claude/settings.json" "$P/src/z"; w Write src/z 2
chk "$(j ReadMcpResourceTool '{"server":"claude.ai Dinero","uri":"x"}')" 2; chk "$(j ReadMcpResourceTool '{"server":"claude.ai Gmail","uri":"x"}')" 0
chk "$(j ReadMcpResourceTool '{"server":"plugin:alekos:alekos","uri":"x"}')" 0; chk "$(j ReadMcpResourceTool '{"uri":"x"}')" 2
chk "$(j ListMcpResourcesTool '{}')" 0; chk "$(j ReadMcpResourceDirTool '{"server":"supabase","uri":"x"}')" 2
chk "$(j mcp__plugin_alekos_alekos__hvem_er_jeg '{}')" 0; chk "$(j mcp__plugin_alekos_alekos__gem_forslag '{"forslag_id":"x"}')" 0
# Claude in Chrome (0.3.0): fly og Facebook ja; Alekos' systemer, Supabase, Lovable, lagrede logins, netværk, browserskift nej
c(){ chk "$(j "mcp__claude-in-chrome__$1" "$2")" "$3"; }
c navigate '{"url":"https://www.airasia.com/da/da"}' 0; c navigate '{"url":"https://www.facebook.com/groups/123"}' 0
c navigate '{"url":"https://alekos.dk/rejser"}' 0; c navigate '{"url":"www.alekos.dk"}' 0; c tabs_context_mcp '{}' 0
c navigate '{"url":"https://admin.alekos.dk/trips"}' 2; c navigate '{"url":"admin.alekos.dk"}' 2; c navigate '{"url":"https://mit.alekos.dk"}' 2
c navigate '{"url":"https://ADMIN.Alekos.dk"}' 2; c navigate '{"url":"https://rufnmcnhebhzhzzgljcs.supabase.co/rest/v1/x"}' 2
c navigate '{"url":"https://supabase.com/dashboard"}' 2; c navigate '{"url":"https://lovable.dev/projects/x"}' 2
c navigate '{"url":"file:///Users/x/.ssh/id_ed25519"}' 2; c navigate '{"url":"chrome://settings/passwords"}' 2
c navigate '{"url":"view-source:https://x"}' 2
c computer '{"action":"type","text":"admin.alekos.dk","tabId":1}' 2; c computer '{"action":"type","text":"Anna Hansen","tabId":1}' 0
c computer '{"action":"type","text":"Skriv til medarbejder@alekos.dk","tabId":1}' 0
c javascript_tool '{"action":"javascript_exec","tabId":1,"text":"document.querySelector(\"#firstName\").value=\"Anna\""}' 0
c javascript_tool '{"action":"javascript_exec","tabId":1,"text":"document.querySelector(\"#cookie-accept\").click()"}' 0
c javascript_tool '{"action":"javascript_exec","tabId":1,"text":"JSON.stringify(localStorage)"}' 2
c javascript_tool '{"action":"javascript_exec","tabId":1,"text":"window[\"session\"+\"Storage\"]"}' 2
c javascript_tool '{"action":"javascript_exec","tabId":1,"text":"document.cookie"}' 2
c javascript_tool '{"action":"javascript_exec","tabId":1,"text":"indexedDB.databases()"}' 2
c javascript_tool '{"action":"javascript_exec","tabId":1,"text":"eval(atob(\"bG9jYWw=\"))"}' 2
c javascript_tool '{"action":"javascript_exec","tabId":1,"text":"fetch(\"https://x.supabase.co/auth/v1/user\")"}' 2
c read_network_requests '{"tabId":1}' 2; c switch_browser '{}' 2; c select_browser '{"deviceId":"x"}' 2
c shortcuts_execute '{"tabId":1,"command":"x"}' 2
c browser_batch '{"actions":[{"name":"navigate","input":{"url":"https://www.vietjetair.com","tabId":1}},{"name":"computer","input":{"action":"screenshot","tabId":1}}]}' 0
c browser_batch '{"actions":[{"name":"computer","input":{"action":"screenshot","tabId":1}},{"name":"navigate","input":{"url":"https://admin.alekos.dk","tabId":1}}]}' 2
c browser_batch '{"actions":[{"name":"javascript_tool","input":{"action":"javascript_exec","tabId":1,"text":"localStorage"}}]}' 2
c browser_batch '{"actions":[{"name":"read_network_requests","input":{"tabId":1}}]}' 2; c browser_batch '{"actions":"x"}' 2
c file_upload '{"paths":["~/Library/Cookies/x"],"ref":"r","tabId":1}' 2; c file_upload '{"paths":["/tmp/billet.pdf"],"ref":"r","tabId":1}' 0
chk "$(j 'mcp__claude-in-chrome__navigate' 'null')" 2
# Kontrollanternes omgåelser (0.3.0)
c navigate '{"url":"https://admin%2ealekos.dk/"}' 2; c navigate '{"url":"https://admin.alekos%2Edk/"}' 2
c navigate '{"url":"https://admin。alekos。dk/"}' 2; c navigate '{"url":"https://admin.alekos.dk./"}' 2
c navigate '{"url":"https://academy.alekos.dk"}' 2; c navigate '{"url":"https://x.lovable.app"}' 2
c navigate '{"url":"javascript:location=1"}' 2; c navigate '{"url":"data:text/html,x"}' 2; c navigate '{"url":"blob:https://x/y"}' 2
c navigate '{"url":"about:blank"}' 2; c navigate '{"url":"edge://x"}' 2; c navigate '{"url":"back"}' 0
c navigate '{"url":"https://www.cebupacificair.com:443/x"}' 0
c computer '{"action":"key","text":"cmd+l","tabId":1}' 2; c computer '{"action":"key","text":"ctrl+t","tabId":1}' 2
c computer '{"action":"key","text":"alt+d","tabId":1}' 2; c computer '{"action":"key","text":"Tab Tab Return","tabId":1}' 0
c computer '{"action":"type","text":"Se alt om rejsen på mit.alekos.dk","tabId":1}' 0
c form_input '{"ref":"r","value":"https://media.alekos.dk/login","tabId":1}' 2
js(){ c javascript_tool "$(python3 -c 'import json,sys;print(json.dumps({"action":"javascript_exec","tabId":1,"text":sys.argv[1]}))' "$1")" "$2"; }
js 'window["local"+"Stor"+"age"]' 2; js 'Reflect.get(globalThis,"x")' 2; js 'Object.getOwnPropertyNames(window)' 2
js 'document["coo"+"kie"]' 2; js '[].constructor.constructor("x")()' 2; js 'setTimeout("x")' 2; js 'window["\x6cocal"]' 2
js 'location="https://x"' 2; js 'location.href="https://x"' 2; js 'window.open("https://x")' 2; js 'decodeURIComponent("%6c")' 2
js 'new Worker(URL.createObjectURL(b))' 2
js 'const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;const e=document.querySelector("#fn");s.call(e,"Anna");e.dispatchEvent(new Event("input",{bubbles:true}))' 0
js 'document.querySelector("#cookie-consent button").click()' 0; js 'const o={file: null}; o' 0
c read_console_messages '{"tabId":1}' 2; c ukendt_nyt '{}' 2
c browser_batch '{"actions":[{"name":"Navigate","input":{"url":"https://admin.alekos.dk","tabId":1}}]}' 2
c browser_batch '{"actions":[{"name":"read_network_requests ","input":{"tabId":1}}]}' 2
c browser_batch '{"actions":[{"name":"browser_batch","input":{"actions":[]}}]}' 2
c file_upload "{\"paths\":[\"$S/.claude/.credentials.json\"],\"ref\":\"r\",\"tabId\":1}" 2; c file_upload "{\"paths\":[\"$S/.claude.json\"],\"ref\":\"r\",\"tabId\":1}" 2
c computer '{"action":"key","text":"ctrl+e","tabId":1}' 2; c computer '{"action":"key","text":"super+l","tabId":1}' 2
c computer '{"action":"key","text":"Control_L+l","tabId":1}' 2; c computer '{"action":"key","text":"cmd+a","tabId":1}' 0
c computer '{"action":"key","text":"cmd+v","tabId":1}' 0; c computer '{"action":"key","text":"shift+Tab","tabId":1}' 0
c navigate '{"url":"https://66469aaf-de55.lovableproject.com"}' 2
c navigate '{"url":"https://www.google.com/url?q=https%3A%2F%2Fadmin%252525252ealekos%252525252edk"}' 2
js 'location["href"]="x"' 2; js 'navigation.navigate("x")' 2; js 'location.pathname' 0
b 'echo x >> ../alekos-claude-plugin/plugins/alekos/hooks/vagt.mjs' 2; b 'rm -rf ~/"VS Code/alekos-claude-plugin"' 2
c file_upload '{"paths":["link/x"],"ref":"r","tabId":1}' 2; c file_upload '{"paths":"x","ref":"r","tabId":1}' 2
# Claude Codes indstillinger
w Write .claude/settings.json 2; w Write .mcp.json 2; w Edit "$S/.claude.json" 2; w Write "$S/.claude/settings.json" 2
w Write "$S/.claude/plans/p.md" 0; w Write "$S/.claude/plans/sub/x.md" 2; w Write "$S/.claude/plans/x.json" 2
b 'echo {} > .mcp.json' 2; b 'echo hi > ~/.claude/settings.json' 2; w Write src/ny.ts 0
# Ugyldigt input
chk 'null' 2; chk '"x"' 2; chk '{"tool_input":{}}' 2; chk '{"tool_name":"Read","tool_input":[]}' 2; chk "$(j Bash '{"command":["ls"]}')" 2
b 'npm test' 0; b 'git status && npm run build' 0

# 0.5.6: spærrede Chrome-adresser fra serveren (kan kun stramme)
ct(){ printf '%s' "$1" | HOME="$S" CLAUDE_CONFIG_DIR= ALEKOS_VAGT_OFFLINE=1 ALEKOS_VAGT_TEST_CHROME="$2" node "$V" >/dev/null 2>&1; r=$?; if [ $r = "$3" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FEJL (fik $r, ville $3): $1 / $2"; fi; }
DIN='[{"domaene":"dinero.dk","hvad":"Dinero"}]'
ALE='[{"domaene":"alekos.dk","undtagen":["alekos.dk","www.alekos.dk"],"kun_adresse":true,"hvad":"Alekos"}]'
ct "$(j mcp__claude-in-chrome__navigate '{"url":"https://app.dinero.dk/x","tabId":1}')" "$DIN" 2
ct "$(j mcp__claude-in-chrome__navigate '{"url":"https://dinero.dk","tabId":1}')" "$DIN" 2
ct "$(j mcp__claude-in-chrome__navigate '{"url":"https://app.dinero.dk/x","tabId":1}')" '[]' 0
ct "$(j mcp__claude-in-chrome__computer '{"action":"type","text":"gå til app.dinero.dk","tabId":1}')" "$DIN" 2
ct "$(j mcp__claude-in-chrome__browser_batch '{"actions":[{"name":"navigate","input":{"url":"https://dinero.dk","tabId":1}}]}')" "$DIN" 2
ct "$(j mcp__claude-in-chrome__navigate '{"url":"https://notdinero.dk","tabId":1}')" "$DIN" 0
ct "$(j mcp__claude-in-chrome__navigate '{"url":"https://www.facebook.com","tabId":1}')" "$DIN" 0
ct "$(j mcp__claude-in-chrome__navigate '{"url":"https://www.alekos.dk","tabId":1}')" "$ALE" 0
ct "$(j mcp__claude-in-chrome__computer '{"action":"type","text":"Se mere på mit.alekos.dk","tabId":1}')" "$ALE" 0
LANGTEKST_INPUT=$(python3 -c 'import json;print(json.dumps({"action":"type","text":"a"*60000,"tabId":1}))')
ct "$(j mcp__claude-in-chrome__computer "$LANGTEKST_INPUT")" "$DIN" 2
# Et regex fra serveren afvises helt (ingen regex længere) → kun den lokale bund; facebook stadig tilladt, admin spærret
ct "$(j mcp__claude-in-chrome__navigate '{"url":"https://www.facebook.com","tabId":1}')" '[{"moenster":"(a+)+$","hvad":"x"}]' 0
# Serveren kan ikke løsne den lokale bund (tom liste eller ugyldig liste → admin.alekos.dk stadig spærret)
ct "$(j mcp__claude-in-chrome__navigate '{"url":"https://admin.alekos.dk","tabId":1}')" '[]' 2
ct "$(j mcp__claude-in-chrome__navigate '{"url":"https://admin.alekos.dk","tabId":1}')" '[{"moenster":"(","hvad":"x"}]' 2

# 0.5.7: Claude Codes eget Alekos-login (browserloginet) — kun en gyldig amcp_-nøgle for Alekos-pluginets server
N="$(cd "$(dirname "$0")/.." && pwd)/plugins/alekos/hooks/noegle.mjs"
nk(){ r=$(node -e "import('$N').then(m=>{const d=JSON.parse(process.argv[1]);console.log(m.vaelgAlekosNoegle(d,1000000)??'null')})" "$1"); if [ "$r" = "$2" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FEJL nøgle (fik $r, ville $2): $1"; fi; }
K43=amcp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA; K43B=amcp_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
nk "{\"mcpOAuth\":{\"plugin:alekos:alekos|abc\":{\"accessToken\":\"$K43\",\"expiresAt\":2000000}}}" "$K43"
nk "{\"mcpOAuth\":{\"plugin:alekos:alekos|abc\":{\"accessToken\":\"$K43\",\"expiresAt\":1010000}}}" null
nk "{\"mcpOAuth\":{\"andet|abc\":{\"accessToken\":\"$K43\",\"expiresAt\":2000000}}}" null
nk "{\"mcpOAuth\":{\"plugin:alekos:alekos|abc\":{\"accessToken\":\"sb-ikke-amcp\",\"expiresAt\":2000000}}}" null
nk "{\"mcpOAuth\":{\"plugin:alekos:alekos|a\":{\"accessToken\":\"$K43\",\"expiresAt\":2000000},\"plugin:alekos:alekos|b\":{\"accessToken\":\"$K43B\",\"expiresAt\":3000000}}}" "$K43B"
nk '{"claudeAiOauth":{"accessToken":"x"}}' null
nk 'null' null
ln_=$(node -e "import('$N').then(m=>console.log(m.lagerNavn({})+'|'+m.lagerNavn({CLAUDE_CONFIG_DIR:'/x/y'})))")
case "$ln_" in "Claude Code-credentials|Claude Code-credentials-"????????) pass=$((pass+1));; *) fail=$((fail+1)); echo "FEJL lagernavn: $ln_";; esac
grep -q 'console\.\(log\|error\)' "$N" && { fail=$((fail+1)); echo "FEJL: noegle.mjs må aldrig skrive noget ud"; } || pass=$((pass+1))

rm -rf "$S"
echo "bestået $pass, fejl $fail"
[ "$fail" = 0 ]
