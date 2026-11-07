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
  personBesked = tekst;
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
// en installeret markedsplads-kopi (alekos@alekos-intern) VINDER over den. Derfor: når en synket kopi beviseligt ligger
// på disken, afinstallerer markedsplads-kopien sig selv i baggrunden, og den synkede tager over ved næste start.
// Aldrig uden en bekræftet synket kopi (ellers ville personen stå uden sikkerhedsvagt), aldrig for Casper.
const MIN_SYNKET = [0, 8, 0];
const rod = () => process.env.CLAUDE_PLUGIN_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rigtig = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
function versionOk(v) {
  const m = typeof v === "string" ? v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/) : null;
  if (!m) return false;
  for (let i = 0; i < 3; i++) {
    const a = Number(m[i + 1]);
    if (a !== MIN_SYNKET[i]) return a > MIN_SYNKET[i];
  }
  return true;
}

/** Kører denne hook fra den org-synkede kopi (under <konfig>/plugins/synced)? */
function koererSomSynket(konfig) {
  return inde(rigtig(path.join(konfig, SYNKET_UNDERMAPPE)), rigtig(rod()));
}

/**
 * Den synkede Alekos-kopi på disken: en mappe under <konfig>/plugins/synced med .claude-plugin/plugin.json, hvor
 * name = "alekos" og version ≥ 0.8.0, og hvor sikkerhedsvagten findes (hooks/hooks.json + hooks/vagt.mjs). Mappernes
 * nøjagtige opbygning kendes ikke, så der ledes (højst 6 niveauer, ingen genveje). Findes ingen: null.
 */
function findSynketKopi(konfig) {
  const top = path.join(konfig, SYNKET_UNDERMAPPE);
  try { if (!fs.lstatSync(top).isDirectory()) return null; } catch { return null; }
  const fil = (p) => { try { return fs.lstatSync(p).isFile(); } catch { return false; } };
  const koe = [[top, 0]];
  let set = 0;
  while (koe.length && set < 2000) {
    const [mappe, dybde] = koe.shift();
    set++;
    const pj = path.join(mappe, ".claude-plugin", "plugin.json");
    if (fil(pj)) {
      const d = laes(pj);
      if (d?.name === "alekos" && versionOk(d.version) && fil(path.join(mappe, "hooks", "hooks.json")) && fil(path.join(mappe, "hooks", "vagt.mjs"))) {
        return { mappe, version: d.version };
      }
    }
    if (dybde >= 6) continue;
    let poster = [];
    try { poster = fs.readdirSync(mappe, { withFileTypes: true }); } catch { continue; }
    for (const e of poster) if (e.isDirectory() && !e.isSymbolicLink()) koe.push([path.join(mappe, e.name), dybde + 1]);
  }
  return null;
}

/** Kører vi som den installerede markedsplads-kopi fra Alekos' GitHub (ikke en lokal mappe, ikke den synkede)? */
function erMarkedspladsKopi(konfig) {
  if (koererSomSynket(konfig)) return false;
  if (!inde(rigtig(path.join(konfig, "plugins", "cache")), rigtig(rod()))) return false;
  const km = laes(path.join(konfig, "plugins", "known_marketplaces.json"))?.[MARKEDSPLADS];
  return km?.source?.source === "github" && erAlekosRepo(km.source.repo);
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

/** Mærkefil: true = prøvet inden for ventetiden (eller filen er et link) → gør intet. Ellers skrives den på ny. */
function forNylig(maerke, ventMs) {
  try {
    const st = fs.lstatSync(maerke);
    if (!st.isFile()) return true; // aldrig gennem et link
    if (Date.now() - st.mtimeMs < ventMs) return true;
  } catch { /* første gang */ }
  return false;
}

/** Returnerer true, hvis overgangen er sat i gang (eller allerede er i gang) — så hentes ingen opdatering fra GitHub. */
function overgangTilSynk() {
  if (process.env.ALEKOS_OPDATERER) return false;
  const konfig = konfigMappe();
  if (erCaspersOpsaetning(konfig)) return false;
  if (!erMarkedspladsKopi(konfig)) return false;
  const synket = findSynketKopi(konfig);
  if (!synket) return false; // aldrig afinstallere uden en bekræftet synket kopi
  const s = laes(path.join(konfig, "settings.json"));
  if (s?.enabledPlugins?.["alekos@synced"] === false) return false; // slået fra: den ville ikke tage over
  const cl = claudeProgram();
  if (!cl) return true;
  const maerke = path.join(konfig, ".alekos-overgang");
  if (forNylig(maerke, 3_600_000)) return true;
  const laas = tagBaggrundsLaas(konfig, ".alekos-overgang.laas", 1_800_000);
  if (!laas) return true;
  try {
    fs.rmSync(maerke, { force: true });
    fs.writeFileSync(maerke, `${new Date().toISOString()} synket ${synket.version}\n`, { flag: "wx", mode: 0o600 });
    const env = { ...process.env, ALEKOS_OPDATERER: "1" };
    // Låsen fjernes af kommandoen selv, også når den fejler (mærket står, så der prøves igen om en time).
    const p = spawn("/bin/sh", ["-c", '"$0" plugin uninstall "$1" && "$0" plugin marketplace remove "$2"; rm -rf "$3"', cl, `alekos@${MARKEDSPLADS}`, MARKEDSPLADS, laas], {
      cwd: konfig, detached: true, stdio: "ignore", env,
    });
    p.unref();
  } catch (e) {
    fs.rmSync(laas, { recursive: true, force: true });
    throw e;
  }
  return true;
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
// Svaret skrives før opdateringstjekket, så en langsom ps aldrig koster beskeden (kontrollantfund 23.10.2026).
try {
  skrivSvar();
} catch { /* svaret må aldrig stoppe Claude Code */ }
let overgang = false;
try {
  overgang = overgangTilSynk();
} catch { overgang = true; /* hellere ingen opdatering end to baggrundskørsler; prøves igen ved næste start */ }
try {
  if (!overgang) opdaterIBaggrunden();
} catch { /* en fejlet opdatering må aldrig stoppe Claude Code; prøves igen om en time */ }
process.exit(0);
