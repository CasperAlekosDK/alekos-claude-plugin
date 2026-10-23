#!/usr/bin/env node
// NØDVEJ (fra 0.5.0 sætter pluginet selv reglerne ved hver start: plugins/alekos/hooks/opstart.mjs).
// Viser Alekos' sikkerhedsregler for Claude Code og fletter dem (efter dit "ja") ind i settings.json.
//   node opsaetning/sikkerhed.mjs          (vis reglerne og spørg)
//   node opsaetning/sikkerhed.mjs --vis    (vis kun, ændr intet)
// Reglerne står ét sted: plugins/alekos/sikkerhed/regler.mjs (samme som opstartsreglen bruger).
// Der tages altid en backup først (navn med millisekunder, overskriver aldrig en gammel backup).
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { erCaspersOpsaetning, flet, konfigMappe, regler } from "../plugins/alekos/sikkerhed/regler.mjs";

// Mål: CLAUDE_CONFIG_DIR (isoleret testinstallation) eller ~/.claude.
const KONFIG = konfigMappe();
const FIL = path.join(KONFIG, "settings.json");

// Værn: Caspers egen opsætning må aldrig ændres af dette script (han tester i en isoleret mappe).
if (erCaspersOpsaetning(KONFIG) && !process.argv.includes("--vis")) {
  console.error("✗ Stop: dette er Caspers egen Claude Code-opsætning (~/.claude). Scriptet ændrer den ikke.");
  console.error("  Test i stedet med opsaetning/test-isoleret.sh (bruger en separat testmappe).");
  process.exit(1);
}
// Pluginets kildemappe (denne mappe) må hverken kommandoer eller Claude skrive i.
const PLUGIN_MAPPE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const KORT = `
Du siger ja til tre ting:
  1. Claude må aldrig læse din browsers filer, din nøglering, ~/.ssh, ~/Hemmeligt eller .env-filer, og må ikke ændre Claude Codes indstillinger.
     Claude in Chrome må bruges i Chrome-profilen "Alekos arbejde" (ikke til Supabase eller Lovable).
  2. Kommandoer, Claude kører, sker i en sandkasse uden adgang til dine private filer og uden Supabase
     (første gang en kommando vil på internettet, spørger Claude Code dig).
  3. Claude Code spørger dig HVER gang, før noget gemmes i Admin. Klik aldrig "altid tillad" der.
`;

const HVORFOR = `
Hvorfor:
  • ~/Library (browsere, cookies, Keychains): din browser har din Admin-session liggende. Kan Claude læse den, kan den
    gøre alt, du kan i Admin, uden om MCP'ens grænser og log.
  • security find-…/dump-keychain: nøgleringen har dine koder.
  • ~/.ssh, ~/Hemmeligt, .env: nøgler og hemmeligheder.
  • Claude Codes indstillinger (settings.json, hooks, plugins), .mcp.json og pluginmappen: Claude må ikke kunne slå
    værnene fra eller tilføje nye MCP-servere. Dine egne skills, agents, kommandoer og CLAUDE.md må gerne rettes. osascript/open -a: kan styre browseren og andre programmer.
  • Andre forbindelser (Gmail, Outlook, Slack …) virker som i dag. Supabase, Dinero og Lovable er fra, medmindre Casper
    slår dem til for dig i Admin → Claude-adgang. Værktøjer, der styrer filer, browser, terminal eller VS Code, er altid spærret.
  • Claude in Chrome kører i din rigtige Chrome. Er profilen logget ind i Admin, ligger login-nøglen dér — derfor
    skal udvidelsen kun være i profilen "Alekos arbejde". Vagten spærrer desuden Alekos' systemer, Supabase og
    Lovable i browseren, JavaScript der læser lagrede logins, netværkstrafik og skift til en anden browser.
  • *.supabase.co: alt skal gå gennem MCP'en "alekos" (faste værktøjer, din adgang, alt logges).
  • ask på gem_forslag: du godkender hvert gem i Claude Codes egen boks (en "ask"-regel vinder over "altid tillad").
  • Sandkassen: deny-reglerne gælder Claudes egne værktøjer, men et script (python, node) i Bash kan gå udenom.
    Sandkassen låser Bash på styresystemets niveau. failIfUnavailable: Claude Code starter ikke, hvis sandkassen ikke
    kan startes (i stedet for at køre uden). allowUnsandboxedCommands=false: Claude kan ikke bede om at køre udenfor.
    Internet: kommandoer må gerne bruge internettet (Claude Code spørger første gang pr. domæne), undtagen *.supabase.co.
`;

console.log(KORT);
console.log("Detaljer — disse regler tilføjes i", FIL, "\n");
console.log(JSON.stringify(regler({ ekstraMapper: [PLUGIN_MAPPE] }), null, 2));
console.log(HVORFOR);
if (process.argv.includes("--vis")) process.exit(0);

// Én fælles readline med en kø af linjer (virker både i Terminal og med svar sendt ind på én gang).
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
const linjer = [];
const venter = [];
rl.on("line", (l) => { const v = venter.shift(); if (v) v(l); else linjer.push(l); });
rl.on("close", () => { while (venter.length) venter.shift()(""); });
const spoerg = (t) => { process.stdout.write(t); return new Promise((r) => { const f = (l) => r(String(l).trim().toLowerCase()); if (linjer.length) f(linjer.shift()); else venter.push(f); }); };

let nu = {};
if (fs.existsSync(FIL)) {
  try {
    nu = JSON.parse(fs.readFileSync(FIL, "utf8"));
  } catch {
    console.error(`✗ ${FIL} er ikke gyldig JSON. Intet ændret — bed Casper om hjælp.`);
    rl.close();
    process.exit(1);
  }
}

const undtagelser = nu?.sandbox?.excludedCommands;
let fjern = false;
if (Array.isArray(undtagelser) && undtagelser.length) {
  console.log(`⚠ Du har kommandoer, der kører UDEN sandkasse (sandbox.excludedCommands): ${undtagelser.join(", ")}`);
  fjern = (await spoerg('Skal de fjernes? Anbefales. Skriv "ja" for at fjerne: ')) === "ja";
}

const svar = await spoerg('Skriv "ja" for at tilføje reglerne (alt andet = stop): ');
rl.close();
if (svar !== "ja") {
  console.log("Intet ændret.");
  process.exit(0);
}

if (fs.existsSync(FIL)) {
  const t = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").replace(".", "-").replace("Z", "");
  const backup = `${FIL}.backup-${t}`;
  fs.copyFileSync(FIL, backup, fs.constants.COPYFILE_EXCL); // fejler hellere end at overskrive
  console.log("Backup:", backup);
} else {
  fs.mkdirSync(path.dirname(FIL), { recursive: true });
}

fs.writeFileSync(FIL, JSON.stringify(flet(nu, { konfig: KONFIG, ekstraMapper: [PLUGIN_MAPPE], fjernUndtagelser: fjern }), null, 2) + "\n");
console.log("✓ Reglerne er tilføjet. Genstart VS Code-vinduet (Command Palette → Developer: Reload Window).");
console.log("  Tjek bagefter i Claude Code med /permissions og /sandbox.");
if (Array.isArray(undtagelser) && undtagelser.length && !fjern) {
  console.log("⚠ sandbox.excludedCommands er IKKE fjernet — de kommandoer kører stadig uden sandkasse.");
}
