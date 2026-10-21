// Alekos' sikkerhedsregler for Claude Code — ÉT sted. Bruges af opstartsreglen (hooks/opstart.mjs, sætter dem
// automatisk ved hver start fra 0.5.0) og af nødvejen opsaetning/sikkerhed.mjs (viser/spørger).
// Et plugin kan ikke selv sætte permissions eller sandkasse i sin egen konfiguration (Claude Code fjerner dem),
// derfor flettes de ind i brugerens settings.json.
// Fletningen tilføjer kun: eksisterende regler bliver stående. Undtagelser: sandbox.excludedCommands fjernes
// (de kommandoer kører ellers uden sandkasse) og gamle regler fra 0.2-0.3 (FJERNEDE_REGLER).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Hele mapperne — ikke en liste over browsere, så nye/ukendte browsere også er dækket.
export const LAAST = [
  "~/Library/Application Support",
  "~/Library/Containers",
  "~/Library/Group Containers",
  "~/Library/Cookies",
  "~/Library/Safari",
  "~/Library/WebKit",
  "~/Library/HTTPStorages",
  "~/Library/Keychains",
  "~/.mozilla",
  "~/.ssh",
  "~/Hemmeligt",
  "~/.config",
  "~/.supabase",
  "~/.aws",
  "~/.docker",
];
// Enkeltfiler med nøgler/historik.
export const LAAST_FILER = ["~/.netrc", "~/.npmrc", "~/.pypirc", "~/.git-credentials", "~/.zsh_history", "~/.bash_history", "~/.zhistory"];

// Kendte farlige MCP-servere. Permission-regler kan ikke bruge wildcard over servernavne (fx alle "mcp__plugin_*"),
// så den generelle spærring ligger i vagten (hooks/vagt.mjs). 0.4.0: ingen faste MCP-spærringer her — Casper
// styrer forbindelserne fra Admin (vagten henter reglerne).
const FARLIGE_MCP = [];
const GAMLE_MCP_REGLER = [
  "mcp__claude_ai_Supabase__*", "mcp__claude-vscode__*", "mcp__ide__*",
  "mcp__supabase__*", "mcp__playwright__*", "mcp__puppeteer__*", "mcp__desktop-commander__*", "mcp__filesystem__*",
  "mcp__plugin_playwright_playwright__*", "mcp__plugin_chrome-devtools-mcp_chrome-devtools__*",
];
const CHROME_REGEL = "mcp__claude-in-chrome__*";
// Regler fra 0.2-0.3, der fjernes igen (medarbejderne skal kunne det samme som i dag).
// VIGTIGT: fletningen tilføjer kun. Fjerner du en regel fra regler() senere, bliver den stående hos alle,
// medmindre du OGSÅ lægger den her.
export const FJERNEDE_REGLER = [
  CHROME_REGEL, ...GAMLE_MCP_REGLER, "Edit(~/.claude/CLAUDE.md)", "Edit(~/.claude/skills/**)", "Edit(~/.claude/agents/**)",
  "Edit(~/.claude/commands/**)", "Edit(**/.claude/**)",
];

export const GEM_VAERKTOEJ = "mcp__plugin_alekos_alekos__gem_forslag";

// Markedspladsen på GitHub (offentligt repo, Caspers valg 21.10.2026). Opstartsreglen slår automatisk opdatering til,
// så nye udgaver (regler, vagt, login) kommer ud uden zip og uden at medarbejderen gør noget.
export const MARKEDSPLADS = "alekos-intern";
export const GITHUB_REPO = "CasperAlekosDK/alekos-claude-plugin";

/** Claude Codes opsætningsmappe: CLAUDE_CONFIG_DIR (isoleret test) eller ~/.claude. */
export function konfigMappe(env = process.env) {
  return env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), ".claude");
}
export const erStandard = (konfig) => konfig === path.join(os.homedir(), ".claude");

/** Den rigtige sti (links fulgt; findes mappen ikke, så den nærmeste forælder, der findes), med små bogstaver. */
export function egentligSti(p) {
  let rest = "";
  let cur = path.resolve(p);
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), rest).toLowerCase();
    } catch {
      const op = path.dirname(cur);
      if (op === cur) return path.resolve(p).toLowerCase();
      rest = path.join(path.basename(cur), rest);
      cur = op;
    }
  }
}
const indeI = (mappe, sti) => {
  const r = path.relative(mappe, sti);
  return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
};

/**
 * Værn: Caspers egen Claude Code-opsætning må ALDRIG ændres (det ville spærre alle hans MCP'er).
 * Han tester kun i en isoleret mappe (CLAUDE_CONFIG_DIR, opsaetning/test-isoleret.sh).
 * Hjemmemappen tages fra brugerdatabasen (ikke HOME), links følges, og store/små bogstaver er ens (macOS)
 * — kontrollantfund 21.10.2026: et link eller ".CLAUDE" kom før uden om værnet.
 */
export function erCaspersOpsaetning(konfig) {
  const u = os.userInfo();
  if (u.username !== "casperkloster") return false;
  const k = egentligSti(konfig);
  return [path.join(u.homedir, ".claude"), path.join(os.homedir(), ".claude")].some((c) => indeI(egentligSti(c), k));
}

const absolut = (p) => `/${p}`; // "//" i en regel = absolut sti

/** Reglerne. ekstraMapper = mapper, kommandoer/Claude ikke må skrive i (fx pluginets kildemappe). */
export function regler({ ekstraMapper = [] } = {}) {
  const mapper = [...new Set(ekstraMapper.filter(Boolean).map((m) => path.resolve(m)))];
  return {
    permissions: {
      deny: [
        ...LAAST.map((p) => `Read(${p}/**)`),
        "Read(**/.env)",
        "Read(**/.env.*)",
        "Read(**/.envrc)",
        ...LAAST_FILER.map((f) => `Read(${f})`),
        // Kode, der senere kører UDEN sandkasse (git-hooks, VS Code-opgaver/indstillinger).
        "Edit(**/.git/hooks/**)",
        "Edit(**/.husky/**)",
        "Edit(**/.vscode/tasks.json)",
        "Edit(**/.vscode/settings.json)",
        "Edit(**/.vscode/launch.json)",
        "Edit(**/*.code-workspace)",
        // Claude Codes indstillinger. ~/.claude/plans er bevidst IKKE spærret, så plan-tilstand virker;
        // vagten tillader kun *.md direkte i ~/.claude/plans og blokerer resten af ~/.claude.
        // (0.4.0: egne skills, agents, kommandoer og CLAUDE.md må gerne rettes — som i dag.)
        "Edit(~/.claude/settings.json)",
        "Edit(~/.claude/settings.local.json)",
        "Edit(~/.claude/plugins/**)",
        "Edit(~/.claude/hooks/**)",
        "Edit(~/.claude/projects/**)",
        "Edit(~/.claude.json)",
        "Edit(**/.claude/settings.json)",
        "Edit(**/.claude/settings.local.json)",
        "Edit(**/.claude/hooks/**)",
        "Edit(**/.mcp.json)",
        "Edit(**/.claude.json)",
        ...mapper.map((m) => `Edit(${absolut(m)}/**)`),
        "Bash(security find-generic-password *)",
        "Bash(security find-internet-password *)",
        "Bash(security dump-keychain *)",
        "Bash(security export *)",
        "Bash(security -i *)",
        "Bash(security add-* *)",
        "Bash(security delete-* *)",
        "Bash(security set-* *)",
        "Bash(security import *)",
        "Bash(security create-keychain *)",
        "Bash(security list-keychains *)",
        "Bash(security default-keychain *)",
        "Bash(curl *supabase.co*)",
        "Bash(wget *supabase.co*)",
        "Bash(osascript *)",
        "Bash(open *)",
        "Bash(/usr/bin/open *)",
        "Bash(osacompile *)",
        "WebFetch(domain:supabase.co)",
        "WebFetch(domain:*.supabase.co)",
        ...FARLIGE_MCP,
      ],
      ask: [GEM_VAERKTOEJ],
      // Ingen "spring alle godkendelser over" (så gem_forslag altid spørger, også fra en agent).
      disableBypassPermissionsMode: "disable",
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      // Pluginmappen og Claude Codes egen mappe: kommandoer må ikke skrive dér (rettes kun via Edit, som vagten tjekker).
      filesystem: { denyRead: [...LAAST, ...LAAST_FILER], denyWrite: [...mapper, "~/.claude", "~/.claude.json"] },
      // 0.4.0: kommandoer må gerne bruge internettet (Claude Code spørger første gang pr. domæne) — undtagen Supabase.
      network: { deniedDomains: ["supabase.co", "*.supabase.co"] },
    },
  };
}

const union = (a = [], b = []) => [...new Set([...(Array.isArray(a) ? a : []), ...b])];
const erObjekt = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

/**
 * Fletter reglerne ind i en eksisterende settings.json (objekt). Ændrer ikke input. Idempotent: flet(flet(x)) = flet(x).
 * konfig = Claude Codes opsætningsmappe (en isoleret testmappe spærres også eksplicit).
 */
export function flet(nu, { konfig, ekstraMapper = [], fjernUndtagelser = true } = {}) {
  const R = regler({ ekstraMapper });
  const ud = structuredClone(erObjekt(nu) ? nu : {});
  if (!erObjekt(ud.permissions)) ud.permissions = {};
  ud.permissions.deny = union(ud.permissions.deny, R.permissions.deny).filter((r) => !FJERNEDE_REGLER.includes(r));
  ud.permissions.ask = union(ud.permissions.ask, R.permissions.ask);
  ud.permissions.disableBypassPermissionsMode = "disable";
  if (Array.isArray(ud.permissions.allow)) {
    // En allow på gem-værktøjet ville være død (ask vinder), men fjern den, så det er tydeligt.
    ud.permissions.allow = ud.permissions.allow.filter((r) => r !== GEM_VAERKTOEJ && !String(r).startsWith("mcp__plugin_alekos_alekos__gem"));
  }
  if (ud.permissions.defaultMode === "bypassPermissions") delete ud.permissions.defaultMode;
  if (!erObjekt(ud.sandbox)) ud.sandbox = {};
  ud.sandbox.enabled = true;
  ud.sandbox.failIfUnavailable = true;
  ud.sandbox.allowUnsandboxedCommands = false;
  if (!erObjekt(ud.sandbox.filesystem)) ud.sandbox.filesystem = {};
  ud.sandbox.filesystem.denyRead = union(ud.sandbox.filesystem.denyRead, R.sandbox.filesystem.denyRead);
  ud.sandbox.filesystem.denyWrite = union(ud.sandbox.filesystem.denyWrite, R.sandbox.filesystem.denyWrite);
  // Isoleret test (CLAUDE_CONFIG_DIR): spær også testmappen og den rigtige ~/.claude for Claudes værktøjer.
  if (konfig && !erStandard(konfig)) {
    ud.permissions.deny = union(ud.permissions.deny, ["Edit(~/.claude/**)", `Edit(${absolut(konfig)}/settings.json)`, `Edit(${absolut(konfig)}/plugins/**)`]);
    ud.sandbox.filesystem.denyWrite = union(ud.sandbox.filesystem.denyWrite, [konfig]);
  }
  if (!erObjekt(ud.sandbox.network)) ud.sandbox.network = {};
  delete ud.sandbox.network.strictAllowlist; // 0.3.x lukkede helt for internet i kommandoer
  ud.sandbox.network.deniedDomains = union(ud.sandbox.network.deniedDomains, R.sandbox.network.deniedDomains);
  if (Array.isArray(ud.sandbox.network.allowedDomains)) {
    ud.sandbox.network.allowedDomains = ud.sandbox.network.allowedDomains.filter((d) => !/supabase\.co$/i.test(String(d)));
  }
  if (fjernUndtagelser) delete ud.sandbox.excludedCommands;
  // Automatisk opdatering — KUN når markedspladsen er Alekos' GitHub-repo (kilden ændres aldrig her).
  const mp = erObjekt(ud.extraKnownMarketplaces) ? ud.extraKnownMarketplaces[MARKEDSPLADS] : null;
  if (erObjekt(mp) && erObjekt(mp.source) && mp.source.source === "github" && String(mp.source.repo).toLowerCase() === GITHUB_REPO.toLowerCase()) {
    mp.autoUpdate = true;
  }
  return ud;
}
