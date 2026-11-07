#!/usr/bin/env node
// Alekos-pluginets opstartsregel (SessionStart, fra 0.5.0 — Caspers krav 21.10.2026: ingen Terminal, ingen zip).
// Fletter Alekos' sikkerhedsregler (sikkerhed/regler.mjs) ind i Claude Codes settings.json ved hver start, uden
// spørgsmål. Idempotent: står reglerne der allerede, ændres intet. Før hver ændring tages en backup.
// Værn:
// - Caspers egen opsætning (~/.claude som brugeren casperkloster) røres ALDRIG.
// - En ugyldig settings.json ændres aldrig (personen får besked i stedet).
// - Fejl her stopper aldrig Claude Code; sikkerhedsvagten (vagt.mjs) virker uanset.
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MARKEDSPLADS, SYNKET_UNDERMAPPE, erAlekosRepo, erCaspersOpsaetning, flet, konfigMappe } from "../sikkerhed/regler.mjs";

const BACKUP_PREFIX = "settings.json.alekos-backup-";
const FOERSTE_BACKUP = "settings.json.foer-alekos"; // slettes aldrig
const MAKS_BACKUPS = 5;
const LAAS = ".alekos-opstart.laas";

// systemMessage vises for personen; additionalContext går til Claude, så den selv beder om genstart (VS Code kan
// skjule hook-beskeder — kontrollantfund 21.10.2026). Hook-svaret må kun være ét JSON-objekt — det skrives i bunden.
let personBesked = null;
function besked(tekst) {
  personBesked = personBesked ? `${personBesked}\n${tekst}` : tekst;
}

/** Udgaven, der kører (0.7.2, Noahs ønske 23.10.2026: Claude kunne ikke se, om pluginet var opdateret). */
function koerendeUdgave() {
  const v = laes(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".claude-plugin", "plugin.json"))?.version;
  return typeof v === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) ? v : "ukendt";
}

function skrivSvar() {
  let udgave = `Alekos-pluginet kører udgave ${koerendeUdgave()} (nyeste udgave står i hvem_er_jeg under udgaver.plugin_nyeste; nævn den kun, hvis medarbejderen spørger, eller hvis den kørende er ældre).`;
  // 0.8.0: kører vi som org-synket kopi, skal vi kunne se, hvad Alekos-værktøjerne faktisk hedder (ikke bevist endnu).
  try {
    if (koererSomSynket(konfigMappe())) {
      udgave += " Pluginet er hentet via org-synk (alekos@synced). Hedder Alekos-værktøjerne IKKE mcp__plugin_alekos_alekos__…, så sig til medarbejderen, at Casper skal have det præcise værktøjsnavn (fx mcp__…__hvem_er_jeg).";
    }
  } catch { /* kun en oplysning */ }
  const svar = { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: udgave } };
  if (personBesked) {
    svar.systemMessage = personBesked;
    svar.hookSpecificOutput.additionalContext = `Besked fra Alekos-pluginet til medarbejderen (sig den med det samme, kort): ${personBesked}\n${udgave}`;
  }
  process.stdout.write(JSON.stringify(svar));
}

const inde = (mappe, sti) => {
  const r = path.relative(mappe, sti);
  return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
};
const laes = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

/** Er mappen beviseligt Alekos-pluginet (eller dets markedsplads)? Aldrig /, hjemmemappen eller en mappe over den. */
function erAlekosMappe(p, art) {
  let r;
  try { r = fs.realpathSync(p); } catch { return null; }
  const hjem = [os.userInfo().homedir, os.homedir()].map((h) => { try { return fs.realpathSync(h); } catch { return h; } });
  if (r === path.parse(r).root || hjem.some((h) => inde(r, h))) return null; // / eller hjemmemappen eller over den
  if (art === "plugin") return laes(path.join(r, ".claude-plugin", "plugin.json"))?.name === "alekos" ? r : null;
  return laes(path.join(r, ".claude-plugin", "marketplace.json"))?.name === "alekos-intern" ? r : null;
}

/** Pluginets egne mapper uden for Claude Codes opsætning (fx en lokal kildemappe), som skal være skrivebeskyttede. */
function pluginMapper(konfig) {
  const ud = [];
  const rod = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  ud.push(erAlekosMappe(rod, "plugin"));
  const m = laes(path.join(konfig, "plugins", "known_marketplaces.json"))?.["alekos-intern"];
  for (const p of [m?.installLocation, m?.source?.path]) if (typeof p === "string" && p) ud.push(erAlekosMappe(p, "markedsplads"));
  let k = konfig;
  try { k = fs.realpathSync(konfig); } catch { /* findes ikke endnu */ }
  return [...new Set(ud.filter(Boolean))].filter((p) => !inde(k, p));
}

function ryddBackups(mappe) {
  const filer = fs.readdirSync(mappe).filter((f) => f.startsWith(BACKUP_PREFIX)).sort();
  for (const f of filer.slice(0, Math.max(0, filer.length - MAKS_BACKUPS))) fs.rmSync(path.join(mappe, f), { force: true });
}

/** Kun én start ad gangen skriver (to VS Code-vinduer kan starte samtidig). Låsen regnes for død efter 30 sek. */
function tagLaas(konfig) {
  const l = path.join(konfig, LAAS);
  try {
    fs.mkdirSync(l);
    return () => fs.rmSync(l, { recursive: true, force: true });
  } catch (e) {
    if (e?.code !== "EEXIST") throw e; // fx ingen skriveret: giv besked (fanges i bunden)
    try {
      if (Date.now() - fs.statSync(l).mtimeMs > 30_000) {
        fs.rmSync(l, { recursive: true, force: true });
        fs.mkdirSync(l);
        return () => fs.rmSync(l, { recursive: true, force: true });
      }
    } catch { /* en anden tog den */ }
    return null;
  }
}

function koer() {
  const konfig = konfigMappe();
  if (erCaspersOpsaetning(konfig)) return; // aldrig Caspers egen opsætning
  const fil = path.join(konfig, "settings.json");

  let nu = {};
  let raa = null;
  if (fs.existsSync(fil)) {
    if (fs.lstatSync(fil).isSymbolicLink()) {
      besked("Alekos: sikkerhedsreglerne blev ikke sat, fordi settings.json er et link. Ring til Casper.");
      return;
    }
    raa = fs.readFileSync(fil, "utf8");
    try {
      const ren = raa.replace(/^\uFEFF/, "");
      nu = ren.trim() ? JSON.parse(ren) : {};
    } catch {
      besked(`Alekos: sikkerhedsreglerne kunne ikke sættes, fordi ${fil} ikke er gyldig JSON. Intet er ændret. Ring til Casper.`);
      return;
    }
    if (nu === null || typeof nu !== "object" || Array.isArray(nu)) {
      besked(`Alekos: sikkerhedsreglerne kunne ikke sættes, fordi ${fil} har et uventet indhold. Intet er ændret. Ring til Casper.`);
      return;
    }
  }

  const ny = flet(nu, { konfig, ekstraMapper: pluginMapper(konfig), fjernUndtagelser: true });
  if (raa !== null && JSON.stringify(ny) === JSON.stringify(nu)) return; // står der allerede
  const tekst = JSON.stringify(ny, null, 2) + "\n";

  fs.mkdirSync(konfig, { recursive: true });
  const slipLaas = tagLaas(konfig);
  if (!slipLaas) return; // en anden start er i gang med det samme
  try {
    // Læs igen under låsen: er filen ændret imens, gør næste start det (aldrig overskrive en frisk ændring).
    const nuRaa = fs.existsSync(fil) ? fs.readFileSync(fil, "utf8") : null;
    if (nuRaa !== raa) return;
    const foerste = !fs.existsSync(path.join(konfig, FOERSTE_BACKUP));
    if (raa !== null) {
      if (foerste) fs.writeFileSync(path.join(konfig, FOERSTE_BACKUP), raa, { flag: "wx", mode: 0o600 });
      const t = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").replace(".", "-").replace("Z", "");
      fs.writeFileSync(path.join(konfig, `${BACKUP_PREFIX}${t}-${process.pid}-${crypto.randomBytes(3).toString("hex")}`), raa, { flag: "wx", mode: 0o600 });
      ryddBackups(konfig);
    } else if (foerste) {
      fs.writeFileSync(path.join(konfig, FOERSTE_BACKUP), "{}\n", { flag: "wx", mode: 0o600 }); // der var ingen fil
    }
    // Atomisk: skriv en midlertidig fil og omdøb (en halvt skrevet settings.json ville stoppe Claude Code).
    const tmp = path.join(konfig, `.settings.json.alekos-${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
    fs.writeFileSync(tmp, tekst, { flag: "wx", mode: 0o600 });
    fs.renameSync(tmp, fil);
    const fjernet = Array.isArray(nu?.sandbox?.excludedCommands) && nu.sandbox.excludedCommands.length
      ? ` Kommandoer, der før kørte uden sandkasse (${nu.sandbox.excludedCommands.slice(0, 5).join(", ")}), kører nu i sandkassen.`
      : "";
    besked((foerste
      ? "Alekos: sikkerhedsreglerne er sat. Genstart VS Code-vinduet én gang (⌘ + Shift + P → Developer: Reload Window), så sandkassen er slået til."
      : "Alekos: sikkerhedsreglerne er opdateret. Genstart VS Code-vinduet (⌘ + Shift + P → Developer: Reload Window).") + fjernet);
  } finally {
    slipLaas();
  }
}

/**
 * Henter nyeste udgave af pluginet i baggrunden (højst én gang i timen), med Claude Codes egne kommandoer.
 * Claude Codes indbyggede autoUpdate kørte ikke i test 21.10.2026 (11 min, ingen opdatering) — derfor også dette.
 * Kun for Alekos' GitHub-markedsplads; aldrig for en lokal mappe (Caspers test). Ny udgave bruges ved næste start.
 */
/**
 * Stien til det Claude Code-program, der startede denne hook. CLAUDE_CODE_EXECPATH gives IKKE til hooks (kun til
 * Bash-værktøjet — kontrollantfund 21.10.2026), så vi går op gennem forælderprocesserne til et program ved navn claude.
 */
function claudeProgram() {
  const ok = (p) => {
    if (!p || !path.isAbsolute(p) || path.basename(p) !== "claude") return null;
    try { return fs.statSync(p).isFile() ? p : null; } catch { return null; }
  };
  let pid = process.ppid;
  for (let i = 0; i < 6 && pid > 1; i++) {
    let ud;
    try {
      ud = execFileSync("/bin/ps", ["-o", "ppid=", "-o", "comm=", "-p", String(pid)], { encoding: "utf8", timeout: 2000 }).trim();
    } catch { return null; }
    const m = ud.match(/^(\d+)\s+(.+)$/);
    if (!m) return null;
    const fundet = ok(m[2].trim());
    if (fundet) return fundet;
    pid = Number(m[1]);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// 0.8.0: overgang til org-synk (claude.ai). Den synkede kopi (alekos@synced) ligger under <konfig>/plugins/synced, men
// en installeret markedsplads-kopi (alekos@alekos-intern) VINDER over den (samme navn) — så den synkede kopis hooks kører
// sandsynligvis slet ikke, mens markedsplads-kopien er installeret. Et automatisk "bevis" fra den synkede kopi kan derfor
// aldrig komme, og en automatisk afinstallering uden bevis kan efterlade Mac'en uden sikkerhedsvagt (kontrolfund 07.11.2026).
// Valg: INGEN automatisk afinstallering (en afinstallering midt i en session ville også fjerne den vagt.mjs, der kører).
// Når Casper har tændt kontakten på serveren (org_synk_overgang), siger markedsplads-kopien højst én gang i døgnet til
// medarbejderen, at org-synk er klar, og hvad der skal skrives; den synkede kopi bekræfter selv ved næste start ("kører nu via org-synk"). Kommer den bekræftelse ikke,
// ringer medarbejderen til Casper — og installerer igen fra markedspladsen, som bevares (kun plugin uninstall).
const MIN_SYNKET = "0.8.0";
const rod = () => process.env.CLAUDE_PLUGIN_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rigtig = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const UDGAVE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
/** a ≥ b for x.y.z (ugyldig = false). */
function mindst(a, b) {
  const x = typeof a === "string" ? a.match(UDGAVE) : null;
  const y = typeof b === "string" ? b.match(UDGAVE) : null;
  if (!x || !y) return false;
  for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) > Number(y[i]);
  return true;
}

/** Kører denne hook fra den org-synkede kopi (under <konfig>/plugins/synced)? */
function koererSomSynket(konfig) {
  return inde(rigtig(path.join(konfig, SYNKET_UNDERMAPPE)), rigtig(rod()));
}

/**
 * Den synkede Alekos-kopi, som Claude Code bruger. Opbygning set på Caspers Mac 07.11.2026 (kun læst):
 *   plugins/synced/<org>_<uuid>/            — én "spand" pr. synk-runde; .last-complete-round = runden blev færdig
 *   plugins/synced/<org>_<uuid>/manifest.json   { plugins: [{ name: "<mappenavn>", … }] }
 *   plugins/synced/<org>_<uuid>/<mappenavn>/.in_use + .claude-plugin/plugin.json (+ resten af pluginet)
 *   plugins/synced/.bucket-<org>_<uuid>     — tomme mærkefiler (ignoreres)
 * Kun den NYESTE færdige spand pr. organisation tæller (gamle spande kan stadig have en .in_use-kopi). Kopien skal stå
 * i spandens manifest, have .in_use, name = "alekos", version ≥ minUdgave og Alekos' vagt i hooks. Ingen genveje.
 */
function findSynketKopi(konfig, minUdgave) {
  const top = path.join(konfig, SYNKET_UNDERMAPPE);
  const st = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
  const fil = (p) => !!st(p)?.isFile();
  const tekst = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
  if (!st(top)?.isDirectory()) return null;
  let spande = [];
  try { spande = fs.readdirSync(top, { withFileTypes: true }); } catch { return null; }
  const nyeste = new Map(); // org → { mappe, tid }
  for (const e of spande) {
    if (!e.isDirectory() || e.isSymbolicLink() || e.name.startsWith(".")) continue;
    const runde = st(path.join(top, e.name, ".last-complete-round"));
    if (!runde?.isFile()) continue;
    const org = e.name.split("_")[0];
    const gl = nyeste.get(org);
    if (!gl || runde.mtimeMs > gl.tid) nyeste.set(org, { mappe: path.join(top, e.name), tid: runde.mtimeMs });
  }
  for (const { mappe: spand } of nyeste.values()) {
    const m = laes(path.join(spand, "manifest.json"));
    for (const p of Array.isArray(m?.plugins) ? m.plugins : []) {
      const navn = p?.name;
      if (typeof navn !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(navn) || navn.startsWith(".")) continue;
      const mappe = path.join(spand, navn);
      if (!st(mappe)?.isDirectory()) continue;
      const iBrug = st(path.join(mappe, ".in_use"));
      if (!iBrug || iBrug.isSymbolicLink()) continue;
      const d = laes(path.join(mappe, ".claude-plugin", "plugin.json"));
      const hj = path.join(mappe, "hooks", "hooks.json"), vm = path.join(mappe, "hooks", "vagt.mjs");
      if (d?.name === "alekos" && mindst(d.version, minUdgave) && fil(hj) && fil(vm) &&
          tekst(hj).includes("vagt.mjs") && tekst(vm).includes("Alekos sikkerhedsvagt")) {
        return { mappe, version: d.version };
      }
    }
  }
  return null;
}

/** Serverens kontakt (Admin): må medarbejderen få besked om at skifte til org-synk? Fra vagtens cache; mangler = false. */
function overgangSlaaetTil(konfig) {
  const c = laes(path.join(konfig, "alekos-forbindelser.json"));
  const id = c?.sidste;
  return typeof id === "string" && c?.personer?.[id]?.regler?.org_synk_overgang === true;
}

/** Kører vi som den installerede markedsplads-kopi fra Alekos' GitHub (ikke en lokal mappe, ikke den synkede)? */
function erMarkedspladsKopi(konfig) {
  if (koererSomSynket(konfig)) return false;
  if (!inde(rigtig(path.join(konfig, "plugins", "cache")), rigtig(rod()))) return false;
  const km = laes(path.join(konfig, "plugins", "known_marketplaces.json"))?.[MARKEDSPLADS];
  return km?.source?.source === "github" && erAlekosRepo(km.source.repo);
}

/** Beskeder om org-synk. Ændrer intet i Claude Codes opsætning (kun en lille mærkefil, så bekræftelsen siges én gang). */
function synkBeskeder() {
  const konfig = konfigMappe();
  if (erCaspersOpsaetning(konfig)) return;
  const egen = koerendeUdgave();
  if (koererSomSynket(konfig)) {
    const maerke = path.join(konfig, ".alekos-synk-bekraeftet");
    try { if (!fs.lstatSync(maerke).isFile()) return; if (fs.readFileSync(maerke, "utf8").trim() === egen) return; } catch { /* første gang */ }
    const mpTilbage = !!laes(path.join(konfig, "plugins", "known_marketplaces.json"))?.[MARKEDSPLADS];
    besked(`Alekos-pluginet kører nu via org-synk (udgave ${egen}), og sikkerhedsvagten er slået til.` +
      (mpTilbage ? ` Den gamle markedsplads kan fjernes: skriv /plugin marketplace remove ${MARKEDSPLADS}` : ""));
    try {
      fs.rmSync(maerke, { force: true });
      fs.writeFileSync(maerke, egen + "\n", { flag: "wx", mode: 0o600 });
    } catch { /* så siges det igen næste gang */ }
    return;
  }
  if (!erMarkedspladsKopi(konfig)) return;
  if (!overgangSlaaetTil(konfig)) return; // standard: slået fra (Casper tænder den i Admin)
  const min = mindst(egen, MIN_SYNKET) ? egen : MIN_SYNKET; // aldrig skifte til en ældre udgave
  const synket = findSynketKopi(konfig, min);
  if (!synket) return;
  // Højst én gang i døgnet (kommer alekos-intern igen, fx via extraKnownMarketplaces, bliver det aldrig til en løkke).
  const maerke = path.join(konfig, ".alekos-synk-klar");
  if (forNylig(maerke, 86_400_000)) return;
  try {
    fs.rmSync(maerke, { force: true });
    fs.writeFileSync(maerke, `${new Date().toISOString()} ${synket.version}\n`, { flag: "wx", mode: 0o600 });
  } catch { return; } // kan mærket ikke skrives, siges intet (hellere tavs end hver start)
  besked(`Alekos: org-synk er klar (udgave ${synket.version}). Skriv /plugin uninstall alekos@${MARKEDSPLADS} og genstart VS Code-vinduet. ` +
    `Efter genstarten skal du se "Alekos-pluginet kører nu via org-synk". Ser du den ikke, så skriv /plugin install alekos@${MARKEDSPLADS} og ring til Casper.`);
}

/** Lås i opsætningsmappen (kun én baggrundskørsel ad gangen). null = en anden har den. */
function tagBaggrundsLaas(konfig, navn, doedMs) {
  const laas = path.join(konfig, navn);
  try {
    fs.mkdirSync(laas);
    return laas;
  } catch (e) {
    if (e?.code !== "EEXIST") return null;
    try {
      if (Date.now() - fs.statSync(laas).mtimeMs < doedMs) return null;
      fs.rmSync(laas, { recursive: true, force: true });
      fs.mkdirSync(laas);
      return laas;
    } catch { return null; }
  }
}

/** Mærkefil: true = prøvet inden for ventetiden (eller filen er et link) → gør intet. */
function forNylig(maerke, ventMs) {
  try {
    const st = fs.lstatSync(maerke);
    if (!st.isFile()) return true; // aldrig gennem et link
    if (Date.now() - st.mtimeMs < ventMs) return true;
  } catch { /* første gang */ }
  return false;
}

function opdaterIBaggrunden() {
  if (process.env.ALEKOS_OPDATERER) return; // aldrig i den proces, vi selv starter
  const konfig = konfigMappe();
  if (erCaspersOpsaetning(konfig)) return;
  if (koererSomSynket(konfig)) return; // 0.8.0: org-synk henter selv nye udgaver
  const km = laes(path.join(konfig, "plugins", "known_marketplaces.json"))?.[MARKEDSPLADS];
  if (km?.source?.source !== "github" || !erAlekosRepo(km.source.repo)) return;
  // Kun Claude Codes eget program (ikke fx node, der ellers ville køre ./plugin.js fra projektmappen — kontrollantfund).
  const cl = claudeProgram();
  if (!cl) return;
  const maerke = path.join(konfig, ".alekos-opdateret");
  if (forNylig(maerke, 3_600_000)) return;
  // Lås: kun én opdatering ad gangen (fjernes af kommandoen selv, regnes for død efter 30 min).
  const laas = tagBaggrundsLaas(konfig, ".alekos-opdaterer.laas", 1_800_000);
  if (!laas) return;
  fs.rmSync(maerke, { force: true });
  fs.writeFileSync(maerke, new Date().toISOString() + "\n", { flag: "wx", mode: 0o600 });
  const env = { ...process.env, ALEKOS_OPDATERER: "1" };
  const p = spawn("/bin/sh", ["-c", '"$0" plugin marketplace update "$1" && "$0" plugin update "$2"; rm -rf "$3"', cl, MARKEDSPLADS, `alekos@${MARKEDSPLADS}`, laas], {
    cwd: konfig, detached: true, stdio: "ignore", env,
  });
  p.unref();
}

try {
  koer();
} catch (e) {
  besked(`Alekos: sikkerhedsreglerne kunne ikke sættes (${String(e?.message ?? e).slice(0, 200)}). Sikkerhedsvagten virker stadig. Ring til Casper.`);
}
try {
  synkBeskeder();
} catch { /* kun en besked */ }
// Svaret skrives før opdateringstjekket, så en langsom ps aldrig koster beskeden (kontrollantfund 23.10.2026).
try {
  skrivSvar();
} catch { /* svaret må aldrig stoppe Claude Code */ }
try {
  opdaterIBaggrunden();
} catch { /* en fejlet opdatering må aldrig stoppe Claude Code; prøves igen om en time */ }
process.exit(0);
