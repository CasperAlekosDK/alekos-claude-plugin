#!/usr/bin/env node
// Alekos sikkerhedsvagt (PreToolUse). Stopper Claude, før et værktøj rører:
//  - ~/Library/Application Support, Containers, Group Containers, Cookies, Safari, WebKit, HTTPStorages, Keychains
//    (alle browserprofiler og app-data, også browsere vi ikke kender), ~/.mozilla
//  - nøgleringen via `security` (find-*-password, dump-keychain, export, -i)
//  - ~/.ssh, ~/Hemmeligt og .env/.envrc-filer
//  - direkte kald til *.supabase.co (alt skal gå via MCP'en "alekos")
//  - pluginets egne login-/nøglescripts
//  - ændringer i ~/.claude og pluginets mappe (så værnene ikke kan slås fra)
//  - MCP-servere, der styrer filer, browser, terminal eller editor (altid); andre forbindelser efter Caspers valg pr.
//    person (Admin → Claude-adgang; standard: Supabase, Dinero, Lovable og databaser spærret, resten tilladt)
//  - i Claude in Chrome: Alekos' systemer/Supabase/Lovable, lagrede logins via JavaScript, netværkstrafik, browserskift
// Exit 2 = blokér (stderr vises for Claude). Alt uventet blokeres (fejler lukket).
//
// ÆRLIGT: for Bash er vagten et mønster-tjek og kan omgås (relative stier efter cd, globs, find -exec, base64/eval,
// python -c/node -e, variabler som ${s}rity, citationstegn midt i ord, symlinks). Det reelle værn for Bash er
// sandkassen; for Read/Grep/Glob/Edit/Write er det deny-reglerne. Vagten er et ekstra lag og en tidlig, tydelig besked.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeCodeNoegle } from "./noegle.mjs";

const HOME = os.homedir();
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Hele markedspladsmappen (med opsætningsscriptet), når pluginet køres derfra.
const MARKED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// Claude Codes konfigurationsmappe: ~/.claude, eller CLAUDE_CONFIG_DIR (fx en isoleret testinstallation).
const KONFIG = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(HOME, ".claude");
const BESKYTTET = [path.join(HOME, ".claude"), KONFIG, PLUGIN_ROOT, path.dirname(fileURLToPath(import.meta.url))];
if (fs.existsSync(path.join(MARKED, ".claude-plugin", "marketplace.json"))) BESKYTTET.push(MARKED);

const STIER = [
  [/library\/(application support|containers|group containers|cookies|safari|webkit|httpstorages|keychains)(\/|$)/i, "app-/browserdata eller nøglering i ~/Library"],
  [/(^|\/)\.mozilla(\/|$)/i, "Firefox"],
  [/(^|\/)\.ssh(\/|$)/i, "~/.ssh"],
  [/(^|\/)hemmeligt(\/|$)/i, "~/Hemmeligt"],
  [/(^|\/)\.(config|docker)(\/|$)/i, "nøgler/login i ~/.config eller ~/.docker"],
  [/(^|\/)\.(zsh_history|bash_history|zhistory|npmrc|pypirc|git-credentials)(?=$|[\s"'|;&)<>])/im, "historik/nøglefil i hjemmemappen"],
  [/(^|\/)\.(supabase|aws)(\/|$)/i, "nøgler i ~/.supabase/~/.aws"],
  [/(^|\/)\.netrc(?=$|[\s"'|;&)<>])/im, "~/.netrc"],
  [/(^|[\/\s"'=])\.env(rc|\.(?!example\b|sample\b|template\b)[\w.-]+)?($|[\s"'\/;|&)])/i, ".env-fil"],
];

const BASH = [
  [/\bsecurity\b[^\n|;&]*(find-generic-password|find-internet-password|find-certificate|dump-keychain|export|unlock-keychain|\s-i\b)/i, "nøgleringen (security)"],
  [/supabase\.(co|in|com)\b/i, "direkte kald til Supabase"],
  [/\b(headers|login|faelles)\.mjs\b/i, "Alekos' login-/nøglescripts"],
  [/alekos-claude-plugin/i, "Alekos-pluginets mappe"],
  [/local storage|leveldb|indexeddb|cookies\.binarycookies|login data|web data/i, "browserens lagrede data"],
  [/(^|[\s"'=\/])\.claude(\.json)?(\/|\s|"|'|$)/im, "Claude Codes indstillinger"],
  [/(^|[\s"'=\/])\.mcp\.json\b/i, "MCP-opsætning (.mcp.json)"],
  [/osascript|osacompile|\/usr\/bin\/open\b/i, "osascript/open (kan styre browser og andre programmer)"],
  [/\bosa\w*\$|\$\{?\w*\}?script\b|\$\{?\w*\}?compile\b/i, "sammensat osascript-kommando"],
  [/(^|[;&|\n(`{]|\bthen|\bdo|\belse|\bxargs|\bexec|\benv|\bsudo|\bcommand|\bnohup|\btime)\s*(\w+=\S*\s+)*["']?open["']?(\s|$)/im, "open (kan åbne og styre programmer)"],
  [/\.git\/hooks|\.husky\b|\.vscode\/(tasks|settings|launch)\.json|\.code-workspace\b/i, "git-hooks/VS Code-opsætning (kode der kører uden sandkasse)"],
];

const SKRIVE_VAERKTOEJER = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
// Alekos' egen MCP-server er altid tilladt. Andre: se forbindelser() nedenfor.
const TILLADT_MCP = /^mcp__plugin_alekos_alekos__[a-z0-9_]+$/;
const SOEGEORD = /library|cookies|leveldb|keychains?|\.ssh|local storage|indexeddb|hemmeligt|\.aws|\.netrc|\.supabase|(^|\/)\.(config|docker)(\/|$)|_history|zhistory|\.npmrc|\.pypirc|git-credentials/i;

// Andre forbindelser. Casper styrer ALT fra Admin → Claude-adgang (serveren sender reglerne). Herunder kun nødlisten,
// når der aldrig har været et svar fra serveren (Supabase, Dinero, Lovable, databaser + fil-/browser-/terminal-/editor-styring).
const ALTID_SPAERRET_NOED = /filesystem|file[-_]?system|desktop[-_]?commander|playwright|puppeteer|chrome[-_]?devtools|devtools|claude[-_]?vscode|vscode|^ide$|jetbrains|computer[-_]?use|browserbase|browser[-_]?use|shell|terminal|exec|ssh|docker|kubernetes/i;
// Standarden, hvis serveren ikke kan svare (samme som _shared/alekosMcpForbindelser.ts i Admin: Dinero, Lovable og
// databaser spærret, resten tilladt). Bruges også, hvis personen ikke er logget ind på Alekos-MCP'en.
const FORBINDELSER_STANDARD = {
  altid_spaerret: ALTID_SPAERRET_NOED.source,
  vaerktoej_regler: [],
  regler: [
    { id: "supabase", moenster: "supabase", tilladt: false },
    { id: "dinero", moenster: "dinero", tilladt: false },
    { id: "lovable", moenster: "lovable", tilladt: false },
    { id: "database", moenster: "postgres|mysql|sqlite|mongo|redis|neon|planetscale|bigquery|snowflake|database", tilladt: false },
  ],
  ukendt_tilladt: true,
  chrome_spaerret: [], // den faste lokale bund står i tjekChrome/tjekChromeUrl og gælder altid
};
const FORBINDELSER_CACHE_MS = 10 * 60 * 1000;

function gyldigeRegler(d) {
  if (!d || typeof d !== "object" || !Array.isArray(d.regler) || typeof d.ukendt_tilladt !== "boolean" || typeof d.altid_spaerret !== "string") return null;
  try { new RegExp(d.altid_spaerret, "i"); } catch { return null; }
  const v = d.vaerktoej_regler ?? [];
  if (!Array.isArray(v)) return null;
  for (const r of v) {
    if (!r || typeof r.moenster !== "string" || typeof r.tilladt !== "boolean") return null;
    try { new RegExp(r.moenster, "i"); } catch { return null; }
  }
  for (const r of d.regler) {
    if (!r || typeof r.id !== "string" || typeof r.moenster !== "string" || typeof r.tilladt !== "boolean") return null;
    try { new RegExp(r.moenster, "i"); } catch { return null; }
  }
  // 0.5.6: spærrede adresser i Chrome fra serveren (kan kun stramme; den lokale bund gælder altid). Kun domænenavne —
  // ingen regex fra serveren, så en fejl dér aldrig kan få vagten til at hænge (kontrollantfund 21.10.2026).
  const cs = d.chrome_spaerret ?? [];
  const DOM = /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63}){1,6}$/;
  if (!Array.isArray(cs) || cs.length > 200) return null;
  for (const r of cs) {
    if (!r || typeof r.domaene !== "string" || !DOM.test(r.domaene) || typeof r.hvad !== "string") return null;
    if (r.undtagen !== undefined && (!Array.isArray(r.undtagen) || r.undtagen.some((u) => typeof u !== "string"))) return null;
    if (r.kun_adresse !== undefined && typeof r.kun_adresse !== "boolean") return null;
  }
  return { regler: d.regler, ukendt_tilladt: d.ukendt_tilladt, altid_spaerret: d.altid_spaerret, vaerktoej_regler: v, chrome_spaerret: cs };
}

/**
 * Personens regler fra Alekos-serveren, husket pr. person (hash af MCP-nøglen) i Claude Codes mappe, som Claude ikke
 * kan rette i. Frisk i 10 min. Svarer serveren ikke, eller er nøglen udløbet, gælder personens SIDST KENDTE regler
 * (Caspers "Fra" holder) — og først hvis der aldrig har været et svar, nødlisten. Fejl huskes 1 min (ingen ventetid).
 */
async function forbindelser() {
  if (process.env.ALEKOS_VAGT_OFFLINE === "1") {
    // test: kun nødlisten (+ evt. ekstra spærrede Chrome-adresser — kan kun stramme)
    let ekstra = [];
    try { ekstra = gyldigeRegler({ ...FORBINDELSER_STANDARD, chrome_spaerret: JSON.parse(process.env.ALEKOS_VAGT_TEST_CHROME ?? "[]") })?.chrome_spaerret ?? []; } catch { ekstra = []; }
    return { ...FORBINDELSER_STANDARD, chrome_spaerret: ekstra };
  }
  const fil = path.join(KONFIG, "alekos-forbindelser.json");
  const nu = Date.now();
  let c = {};
  try { const x = JSON.parse(fs.readFileSync(fil, "utf8")); if (x && typeof x === "object" && !Array.isArray(x)) c = x; } catch { /* ingen cache */ }
  const post = (id) => (c.personer && typeof c.personer[id] === "object" ? c.personer[id] : null);
  const kendt = (id) => gyldigeRegler(post(id)?.regler);
  const gem = () => { try { fs.writeFileSync(fil, JSON.stringify(c), { mode: 0o600 }); } catch { /* kun cache */ } };
  let faelles;
  try { faelles = await import("../scripts/faelles.mjs"); } catch { return kendt(c.sidste) ?? FORBINDELSER_STANDARD; }
  let key = null;
  try { key = faelles.hentNoegle(); } catch { key = null; }
  if (!key && process.env.ALEKOS_VAGT_INGEN_NOEGLERING !== "1") key = claudeCodeNoegle(); // browserloginet (0.5.7)
  if (!key) return kendt(c.sidste) ?? FORBINDELSER_STANDARD; // ikke logget ind: den sidste persons regler
  const id = crypto.createHash("sha256").update(key).digest("hex").slice(0, 24);
  const p = post(id);
  const g0 = kendt(id);
  if (g0 && typeof p.hentet === "number" && p.hentet <= nu && nu - p.hentet < FORBINDELSER_CACHE_MS) return g0;
  if (p && typeof p.fejl_til === "number" && p.fejl_til > nu && p.fejl_til - nu <= 60_000) return g0 ?? kendt(c.sidste) ?? FORBINDELSER_STANDARD;
  c.personer = c.personer && typeof c.personer === "object" ? c.personer : {};
  try {
    const res = await fetch(faelles.MCP_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "alekos/forbindelser", params: {} }),
      signal: AbortSignal.timeout(4000),
    });
    const g = res.ok ? gyldigeRegler((await res.json())?.result) : null;
    if (g) {
      // Browserloginets nøgle skifter hver time: ryd personposter, der ikke er brugt i et døgn (dog aldrig den sidste).
      for (const [pid, pp] of Object.entries(c.personer)) {
        if (pid !== c.sidste && !(typeof pp?.hentet === "number" && nu - pp.hentet < 86_400_000)) delete c.personer[pid];
      }
      c.personer[id] = { hentet: nu, regler: g };
      c.sidste = id;
      gem();
      return g;
    }
  } catch { /* netværk/timeout */ }
  c.personer[id] = { ...(p ?? {}), fejl_til: nu + 60_000 };
  gem();
  return g0 ?? kendt(c.sidste) ?? FORBINDELSER_STANDARD;
}

// Claude in Chrome. Navnene er de rå værktøjsnavne efter "mcp__claude-in-chrome__".
// ÆRLIGT: det reelle værn er Chrome-profilen uden Admin-login (guiden). Vagten fanger de oplagte veje (direkte
// navigation, kendte genveje, læsning af lagrede logins i klartekst), men ikke en bevidst omgåelse (links/omdirigeringer,
// opdelt tekst i JavaScript).
const CHROME = /^mcp__claude-in-chrome__[a-z0-9_]+$/;
// Kendte værktøjer. Ukendte (fx nye i en opdatering) blokeres, til vagten er tjekket for dem.
const CHROME_KENDTE = new Set([
  "navigate", "computer", "find", "read_page", "get_page_text", "form_input", "javascript_tool", "tabs_create_mcp",
  "tabs_close_mcp", "tabs_context_mcp", "gif_creator", "upload_image", "file_upload", "read_console_messages",
  "resize_window", "shortcuts_list", "list_connected_browsers", "browser_batch",
  "read_network_requests", "switch_browser", "select_browser", "shortcuts_execute",
]);
// Netværkstrafik kan indeholde login-headere; browserskift kan nå en profil med Admin; genveje kører ukendte trin.
// Konsollen kan vise logins, som en side skriver ud.
const CHROME_SPAERRET = new Set(["read_network_requests", "read_console_messages", "switch_browser", "select_browser", "shortcuts_execute"]);
// Medarbejdersystemer med login, Supabase og Lovable — også når navnet står i tekst, der skrives eller køres.
// (Adressefelter er strengere: der spærres alle alekos.dk-undersider undtagen www, se tjekChromeUrl. I fritekst må fx
// "mit.alekos.dk" gerne stå, så opslag til holdet kan henvise til Mit Alekos.)
const CHROME_SIDER = [
  [/(^|[^a-z0-9.-])([a-z0-9-]+\.)*(admin|vf-system|media|coolify|studio|api)\.alekos\.dk(?![a-z0-9-])/i, "Alekos' systemer (admin.alekos.dk m.fl.)"],
  [/supabase\.(co|com|in)\b/i, "Supabase"],
  [/lovable(project)?\.(dev|app|com)\b/i, "Lovable"],
];
// Adresser i url-felter: kun almindelige websider (http/https eller uden protokol).
const CHROME_PROTOKOL = /^\s*([a-z][a-z0-9+.-]*):(?!\d)/i;
// Genveje til adresselinjen, nye faner og vinduer (så "skriv admin.alekos.dk" ikke kan deles op i flere kald).
const CHROME_TASTER = /\b(cmd|command|meta|super|win|windows|ctrl|control)(_[lr])?\s*\+\s*(shift\s*\+\s*)?(l|t|n|k|e)\b|\balt(_[lr])?\s*\+\s*d\b|\bf6\b/i;
// JavaScript, der kan læse lagrede logins, navigere væk eller skjule, hvad det gør.
const CHROME_JS = new RegExp([
  String.raw`(local|session)\s*storage`, String.raw`["'\x60]\s*storage\s*["'\x60]`, "indexeddb", String.raw`document\s*\.\s*cookie`,
  String.raw`["'\x60]\s*cookie\s*["'\x60]`, "cookiestore", String.raw`\bcaches\b`, "auth-token", "access_token", "refresh_token",
  String.raw`\b(window|globalthis|self|document|top|parent)\s*\[`, String.raw`reflect\s*\.`, "getownpropertynames",
  String.raw`constructor\s*\.\s*constructor`, String.raw`\beval\s*\(`, String.raw`\bfunction\s*\(\s*["'\x60]`,
  String.raw`new\s+function\b`, String.raw`\bset(timeout|interval)\s*\(\s*["'\x60]`, String.raw`\batob\b`, "fromcharcode",
  String.raw`\bimport\s*\(`, String.raw`new\s+worker\b`, "createobjecturl", String.raw`\blocation\s*(=|\.\s*(href\s*=|assign|replace))`,
  String.raw`window\s*\.\s*open\s*\(`, String.raw`location\s*\[`, String.raw`navigation\s*\.\s*navigate`, String.raw`\\x[0-9a-f]{2}`, String.raw`\\u\{?[0-9a-f]{4}`, "decodeuri", "unescape",
].join("|"), "i");

/** Teksten, som browseren ville forstå den: %-kodning og fremmede punktummer (。．｡) gjort til almindelige tegn. */
function chromeTekst(s) {
  let t = String(s).replace(/[。．｡]/g, ".");
  for (let i = 0; i < 12; i++) { try { const d = decodeURIComponent(t); if (d === t) break; t = d; } catch { break; } }
  return t;
}

/**
 * Serverens spærrede adresser (kun stramme): værtsnavnet i en adresse (adresse=true), eller værtsnavne i tekst, der
 * skrives/køres (kun regler uden kun_adresse — fx må "mit.alekos.dk" gerne stå i en besked).
 */
function tjekServerSider(vaerter, ekstra, adresse) {
  for (const e of ekstra) {
    if (e.kun_adresse && !adresse) continue;
    for (const raa of vaerter) {
      const v = raa.toLowerCase().replace(/\.+$/, "");
      if ((v === e.domaene || v.endsWith(`.${e.domaene}`)) && !(e.undtagen ?? []).includes(v)) bloker(`${e.hvad} i browseren (spærret af Alekos)`);
    }
  }
}
// Lineært mønster (ingen indlejret valgfri gruppe), og meget lang tekst afvises, når serverlisten er i brug.
const VAERTER_I_TEKST = /[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const MAKS_CHROME_TEKST = 50_000;

function tjekChromeUrl(url, ekstra = []) {
  const u = String(url).trim();
  if (/^(back|forward)$/i.test(u)) return;
  const m = u.match(CHROME_PROTOKOL);
  if (m && !/^https?$/i.test(m[1])) bloker(`adressen "${m[1]}:" i browseren (kun almindelige websider)`);
  let vaert = "";
  try { vaert = new URL(m ? u : `https://${u}`).hostname.toLowerCase().replace(/\.+$/, ""); } catch { bloker("ugyldig adresse i browseren"); }
  const sider = /(^|\.)(supabase\.(co|com|in)|lovable\.(dev|app)|lovableproject\.com)$/;
  if ((vaert.endsWith(".alekos.dk") && vaert !== "www.alekos.dk") || sider.test(vaert)) {
    bloker(`${vaert} i browseren (brug Alekos-MCP'en til Admin)`);
  }
  tjekServerSider([vaert], ekstra, true);
}

function tjekChrome(navn, input, ekstra = []) {
  if (typeof navn !== "string") bloker("Chrome-kald uden navn");
  navn = navn.trim().toLowerCase().replace(/^mcp__claude-in-chrome__/, "");
  if (!CHROME_KENDTE.has(navn)) bloker(`ukendt Chrome-værktøj "${navn}"`);
  if (!input || typeof input !== "object" || Array.isArray(input)) bloker("Chrome-kald uden input");
  if (CHROME_SPAERRET.has(navn)) bloker(`Chrome-værktøjet ${navn}`);
  if (navn === "browser_batch") {
    if (!Array.isArray(input.actions)) bloker("Chrome-batch uden handlinger");
    for (const a of input.actions) {
      if (!a || typeof a !== "object") bloker("Chrome-batch med ukendt handling");
      if (String(a.name ?? "").trim().toLowerCase().replace(/^mcp__claude-in-chrome__/, "") === "browser_batch") bloker("Chrome-batch i batch");
      tjekChrome(a.name, a.input, ekstra);
    }
    return;
  }
  const alt = chromeTekst(JSON.stringify(input));
  for (const [re, hvad] of CHROME_SIDER) if (re.test(alt)) bloker(`${hvad} i browseren (brug Alekos-MCP'en til Admin)`);
  if (ekstra.length) {
    if (alt.length > MAKS_CHROME_TEKST) bloker("meget lang tekst i browseren (del den op)");
    tjekServerSider(alt.match(VAERTER_I_TEKST) ?? [], ekstra, false);
  }
  if (typeof input.url === "string") tjekChromeUrl(chromeTekst(input.url), ekstra);
  if (navn === "computer" && input.action === "key" && CHROME_TASTER.test(String(input.text ?? ""))) {
    bloker("genvej til adresselinjen, ny fane eller nyt vindue (brug navigate)");
  }
  if (navn === "javascript_tool") {
    const js = String(input.text ?? "");
    if (CHROME_JS.test(js) || CHROME_JS.test(chromeTekst(js))) bloker("JavaScript, der læser lagrede logins, navigerer væk eller er skjult");
  }
  if ("paths" in input && !Array.isArray(input.paths)) bloker("filupload uden liste over filer");
  for (const p of Array.isArray(input.paths) ? input.paths : []) {
    if (typeof p !== "string") bloker("filupload med ugyldig sti");
    for (const s of [normaliser(p), ...filstier(p, cwd)]) {
      for (const [re, hvad] of STIER) if (re.test(s)) bloker(hvad);
      if (s.split(path.sep).includes(".claude") || /(^|\/)\.claude\.json$/.test(s) || BESKYTTET.some((rod) => under(s, rod))) {
        bloker("upload af Claude Codes indstillinger eller Alekos-pluginet");
      }
    }
  }
}

/** Filen, som den ser ud EFTER Write/Edit/MultiEdit (så en rettelse i flere trin ikke kan snige noget ind). */
function faerdigFil(p) {
  let t = "";
  try { t = fs.readFileSync(p, "utf8"); } catch { /* ny fil */ }
  const anvend = (tekst, edits) => {
    for (const e of Array.isArray(edits) ? edits : []) {
      const gl = String(e?.old_string ?? ""), ny = String(e?.new_string ?? "");
      if (!gl || !tekst.includes(gl)) { tekst += "\n" + ny; continue; }
      tekst = e.replace_all ? tekst.split(gl).join(ny) : tekst.replace(gl, () => ny);
    }
    return tekst;
  };
  if (tool === "Write") return String(inp.content ?? "");
  if (tool === "Edit") return anvend(t, [inp]);
  if (tool === "MultiEdit") return anvend(t, inp.edits);
  return t + "\n" + JSON.stringify(inp); // andre skriveværktøjer: tjek alt
}

/**
 * Egne skills/agents/kommandoer må ikke få indstillinger, der kører kode uden sandkasse eller slår værn fra:
 * hooks, mcpServers, permissionMode/bypass, gem_forslag i allowed-tools — heller ikke skjult (flow-YAML, escapes,
 * anker/merge, tags).
 */
function tjekFrontmatter(tekst) {
  const t = String(tekst).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = t.match(/^\s*---[^\S\n]*\n([\s\S]*?)(\n---|$)/);
  if (!m) return;
  const farlig = () => bloker("indstillinger i en skill/agent/kommando, der kan køre kode uden sandkasse eller gemme uden dit ja");
  let noegle = "";
  for (const linje of m[1].split("\n")) {
    // Nøgle på linjen (også i anførselstegn, i lister og med ?-syntaks).
    const k = linje.match(/^[ \t]*(?:-[ \t]*)?\??[ \t]*["']?([^"':#\s][^"':#]*?)["']?[ \t]*:(?=\s|$)/);
    if (k && !/^[ \t]/.test(linje)) noegle = k[1].trim();
    if (k && /^(hooks?|mcp[\s_-]*servers?|permission[\s_-]*mode)$/i.test(k[1].trim())) farlig();
    if (/^[ \t]*\?/.test(linje)) bloker("YAML-nøgle med ?-syntaks i en skill/agent/kommando");
    if (/^[ \t]*[{[]/.test(linje)) bloker("skjult YAML i en skill/agent/kommando (flow-form)");
    if (/^[ \t]*(?:-[ \t]*)?["'][^"'\n]*\\/.test(linje)) bloker("escape-tegn i en nøgle i en skill/agent/kommando");
    if (/^[ \t]*<<[ \t]*:/.test(linje)) bloker("YAML-fletning (<<) i en skill/agent/kommando");
    // Skjult YAML: flow-objekt, anker eller tag dér, hvor en værdi starter (efter "nøgle:" eller "- ").
    const vaerdi = k ? linje.slice(k[0].length) : (linje.match(/^[ \t]*-[ \t]+(.*)$/)?.[1] ?? null);
    if (vaerdi !== null && /^[ \t]*(\{|&[A-Za-z0-9_-]|!)/.test(vaerdi)) bloker("skjult YAML i en skill/agent/kommando (flow-objekt, anker eller tag)");
    if (/^[ \t]*"[^"\n]*\\[xuUN0-9]/.test(vaerdi ?? "")) bloker("escape-tegn i en skill/agent/kommando");
    if (/bypass[\s_-]*permissions/i.test(vaerdi ?? "") && /permission/i.test(noegle)) farlig();
    // Alekos' gem-værktøj må aldrig stå i værktøjslister (heller ikke via * eller kun servernavnet).
    if (/tools/i.test(noegle) && /gem_forslag|mcp__plugin_alekos_alekos(__\*|\*|[\s,\]"']|$)/i.test(linje)) farlig();
  }
}

function bloker(grund) {
  process.stderr.write(
    `Blokeret af Alekos' sikkerhedsvagt: ${grund}. Claude må ikke røre browserdata, nøgleringen, hemmeligheder, ` +
    `Claude Codes indstillinger eller kalde Supabase direkte. Brug MCP-værktøjerne (alekos), og spørg medarbejderen, hvis noget mangler.\n`,
  );
  process.exit(2);
}

function normaliser(s) {
  return String(s ?? "")
    .replaceAll("$HOME", HOME)
    .replaceAll("${HOME}", HOME)
    .replace(/(^|[\s"'=:(])~(?=\/|$)/g, `$1${HOME}`)
    .replace(/\\ /g, " ");
}

/** Filværktøjer: gør stien absolut (ud fra cwd) og følg symlinks, så "../", relative stier og links ikke snyder. */
function filstier(p, cwd) {
  const ud = [];
  const abs = path.resolve(cwd || process.cwd(), normaliser(p));
  ud.push(abs);
  try {
    ud.push(fs.realpathSync(abs));
  } catch {
    // Findes ikke endnu (fx Write): følg den nærmeste eksisterende forælder.
    let d = path.dirname(abs);
    while (d !== path.dirname(d)) {
      try { ud.push(path.join(fs.realpathSync(d), path.relative(d, abs))); break; } catch { d = path.dirname(d); }
    }
  }
  return ud;
}

function under(p, rod) {
  const r = path.resolve(rod);
  return p === r || p.startsWith(r + path.sep);
}

let raw = "";
try {
  for await (const chunk of process.stdin) raw += chunk;
} catch {
  bloker("vagten kunne ikke læse værktøjskaldet");
}
let data;
try {
  data = JSON.parse(raw);
} catch {
  bloker("vagten kunne ikke læse værktøjskaldet");
}
if (!data || typeof data !== "object" || Array.isArray(data)) bloker("ugyldigt værktøjskald");
const tool = data.tool_name;
const inp = data.tool_input;
if (typeof tool !== "string" || !tool) bloker("værktøjskald uden navn");
if (!inp || typeof inp !== "object" || Array.isArray(inp)) bloker("værktøjskald uden input");
const cwd = typeof data.cwd === "string" ? data.cwd : process.cwd();

// Claude in Chrome (0.3.0): tilladt til flybookingsider og Facebook — KUN i en Chrome-profil uden Admin-login (guiden).
// Vagten spærrer det, der kan hente en login-nøgle, hvis profilen alligevel er logget ind et sted.
if (CHROME.test(tool)) {
  // Serverens liste (0.5.6) oveni den faste lokale bund; svarer serveren ikke, gælder sidst kendte/den lokale bund.
  let ekstra = [];
  try { ekstra = (await forbindelser()).chrome_spaerret ?? []; } catch { ekstra = []; }
  tjekChrome(tool.slice("mcp__claude-in-chrome__".length), inp, ekstra);
  process.exit(0);
}

// Andre MCP-servere (0.4.0): Casper styrer dem centralt pr. person (Admin → Claude-adgang → Andre forbindelser).
/** Forbindelsesreglerne for én MCP-server (værktøjer og ressourcer). `rest` = "server__værktøj". */
async function tjekServer(server, rest, navn) {
  if (!server || !/^[a-z0-9_.-]+$/i.test(server)) bloker(`${navn} (ukendt navn)`);
  if (/^plugin_alekos_alekos$/i.test(server)) return;
  if (/^plugin_alekos_/i.test(server)) bloker(`${navn} (udgiver sig for at være Alekos' egen)`);
  const { regler, ukendt_tilladt, altid_spaerret, vaerktoej_regler } = await forbindelser();
  // Fast bund: den lokale liste gælder altid — serveren kan kun stramme, ikke løsne den.
  if (ALTID_SPAERRET_NOED.test(server) || new RegExp(altid_spaerret, "i").test(server)) bloker(`${navn} (styrer filer, browser, terminal eller editor — altid spærret)`);
  // Regler for enkelte værktøjer (fx "Gmail: send nej") går forud — matches fra starten af "server__værktøj".
  const vRegel = (vaerktoej_regler ?? []).find((r) => new RegExp(`^(?:${r.moenster})`, "i").test(rest));
  if (vRegel) {
    if (!vRegel.tilladt) bloker(`${navn} er ikke slået til for dig — spørg Casper (Admin → Claude-adgang)`);
    return;
  }
  const regel = regler.find((r) => new RegExp(r.moenster, "i").test(server));
  if (regel ? !regel.tilladt : !ukendt_tilladt) {
    bloker(`forbindelsen "${server}" (${regel ? regel.id : "ukendt"}) er ikke slået til for dig — spørg Casper (Admin → Claude-adgang)`);
  }
}

if (tool.startsWith("mcp__")) {
  if (TILLADT_MCP.test(tool)) process.exit(0);
  const rest = tool.slice("mcp__".length);
  await tjekServer(rest.split("__")[0] ?? "", rest, `MCP-værktøjet ${tool}`);
  process.exit(0);
}

// MCP-ressourcer (læsning fra en forbindelse uden om værktøjerne) følger de samme regler.
if (["ReadMcpResourceTool", "ReadMcpResourceDirTool", "ListMcpResourcesTool"].includes(tool)) {
  const srv = typeof inp.server === "string" ? inp.server.trim() : "";
  if (!srv) {
    if (tool === "ListMcpResourcesTool") process.exit(0); // kun en liste over navne
    bloker("MCP-ressource uden forbindelse");
  }
  const norm = srv.replace(/[^a-z0-9_.-]+/gi, "_");
  await tjekServer(norm, `${norm}__ressource`, `ressourcer fra forbindelsen "${srv}"`);
  process.exit(0);
}

const erBash = tool === "Bash" || tool === "Monitor";
if (erBash && typeof inp.command !== "string") bloker("kommando, der ikke er tekst");

// Grep/Glob: ingen søgning i hjemmemappen som helhed (eller over den), og ingen søgemønstre efter browser-/nøgledata.
if (tool === "Glob" && typeof inp.pattern === "string" && (/^\s*[\/~]|\$HOME|\$\{HOME\}/.test(inp.pattern) || inp.pattern.includes(".."))) {
  bloker("Glob-mønster med absolut sti eller ..");
}
if (tool === "Grep" && typeof inp.glob === "string" && (/^\s*[\/~]/.test(inp.glob) || inp.glob.includes(".."))) {
  bloker("Grep-filter med absolut sti eller ..");
}
if (tool === "Grep" || tool === "Glob") {
  for (const k of ["pattern", "glob"]) if (typeof inp[k] === "string" && SOEGEORD.test(inp[k])) bloker("søgning efter browser-/nøgledata");
  const rod = path.resolve(cwd, normaliser(typeof inp.path === "string" && inp.path ? inp.path : "."));
  const roedder = [rod];
  try { roedder.push(fs.realpathSync(rod)); } catch { /* findes ikke */ }
  const hjem = path.resolve(HOME);
  for (const r of roedder) {
    if (r === hjem || hjem.startsWith(r.endsWith(path.sep) ? r : r + path.sep)) bloker("søgning i hele hjemmemappen eller over den");
    if (under(r, path.join(hjem, "Library"))) bloker("søgning i ~/Library");
  }
}
const tekster = [];
if (erBash) tekster.push(inp.command);
for (const k of ["file_path", "path", "notebook_path", "pattern", "glob", "url"]) if (typeof inp[k] === "string") tekster.push(inp[k]);
const dele = tekster.map(normaliser);
const tekst = dele.join("\n");

if (tool === "WebFetch" && /supabase\.(co|in|com)\b/i.test(tekst)) bloker("direkte kald til Supabase");

// Tekst-tjek (alle værktøjer).
for (const del of dele) for (const [re, navn] of STIER) if (new RegExp(re.source, re.flags.includes("m") ? re.flags : re.flags + "m").test(del)) bloker(navn);

// Filværktøjer: absolutte og opløste stier.
for (const k of ["file_path", "path", "notebook_path"]) {
  if (typeof inp[k] !== "string" || !inp[k]) continue;
  for (const p of filstier(inp[k], cwd)) {
    for (const [re, navn] of STIER) if (re.test(p)) bloker(navn);
    if (SKRIVE_VAERKTOEJER.has(tool)) {
      try { if (fs.lstatSync(p).isSymbolicLink()) bloker("skrivning gennem en genvej (symlink)"); } catch { /* findes ikke */ }
      // Undtagelse: plan-tilstandens filer (~/.claude/plans/*.md), kun direkte i mappen og efter opløste symlinks.
      const planMapper = [path.join(HOME, ".claude", "plans"), path.join(KONFIG, "plans")];
      for (const m of [...planMapper]) { try { planMapper.push(fs.realpathSync(m)); } catch { /* findes ikke */ } }
      const erPlan = p.endsWith(".md") && planMapper.includes(path.dirname(p));
      const iClaudeMappe = p.split(path.sep).some((d) => d === ".claude");
      const configFil = /^(\.mcp\.json|\.claude\.json)$|\.code-workspace$/i.test(path.basename(p));
      const deler = p.split(path.sep);
      const koerbarKode = deler.includes(".husky") || p.includes(`${path.sep}.git${path.sep}hooks`) ||
        /\/\.vscode\/(tasks|settings|launch)\.json$/i.test(p);
      if (koerbarKode) bloker("ændring af git-hooks/VS Code-opsætning (kode der kører uden sandkasse)");
      // 0.4.0: egne skills, agents, kommandoer og CLAUDE.md må rettes (som i dag) — men aldrig med hooks (de kører
      // kommandoer uden sandkasse), og aldrig i pluginets egne mapper.
      const ci = deler.indexOf(".claude");
      const kRel = under(p, KONFIG) ? path.relative(KONFIG, p).split(path.sep) : null;
      const rest = kRel ?? (ci >= 0 ? deler.slice(ci + 1) : []);
      const egen = ((["skills", "agents", "commands"].includes(rest[0]) && rest.length > 1) || (rest.length === 1 && rest[0] === "CLAUDE.md")) &&
        ![PLUGIN_ROOT, MARKED, path.dirname(fileURLToPath(import.meta.url))].some((rod) => under(p, rod));
      if (egen) {
        tjekFrontmatter(faerdigFil(p));
        continue;
      }
      if (!erPlan && (iClaudeMappe || configFil || BESKYTTET.some((rod) => under(p, rod)))) {
        bloker("ændring af Claude Codes indstillinger (.claude, .mcp.json) eller Alekos-pluginet");
      }
    }
  }
}

if (erBash) for (const [re, navn] of BASH) if (re.test(tekst)) bloker(navn);
process.exit(0);
