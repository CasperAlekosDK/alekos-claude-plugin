#!/usr/bin/env node
// Log ind på Alekos-MCP'en: e-mail + kodeord + koden fra din to-faktor-app.
// Brug (i Terminal, ikke inde i Claude):
//        node login.mjs          (log ind)
//        node login.mjs --ud     (log ud på denne Mac)
//
// Supabase-sessionen sendes direkte til MCP'en, som udleverer en MCP-nøgle (amcp_…). Kun nøglen gemmes
// i nøgleringen; Supabase-sessionen gemmes aldrig lokalt.
import os from "node:os";
import readline from "node:readline";
import { aal, auth, gemNoegle, hentNoegle, mcp, sletGammelSession, sletNoegle } from "./faelles.mjs";

if (process.argv.includes("--ud")) {
  const key = hentNoegle();
  if (key) {
    try {
      await mcp("/logout", {}, key);
    } catch (e) {
      console.error(`(Kunne ikke logge ud på serveren: ${e.message} — nøglen slettes alligevel her.)`);
    }
  }
  sletNoegle();
  sletGammelSession();
  console.log("Du er logget ud af Alekos-MCP'en på denne Mac.");
  process.exit(0);
}

// Én fælles readline med en kø af linjer (virker både i Terminal og når svarene sendes ind på én gang).
// Kodeordet vises ikke på skærmen.
let rl = null;
let skjul = false;
const linjer = [];
const venter = [];
function spoerg(tekst, skjult = false) {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    const skriv = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (s) => { if (!skjul) skriv(s); };
    rl.on("line", (l) => { const v = venter.shift(); if (v) v(l); else linjer.push(l); });
    rl.on("close", () => { while (venter.length) venter.shift()(""); });
  }
  process.stdout.write(tekst);
  skjul = skjult;
  return new Promise((resolve) => {
    const svar = (l) => { if (skjult) { skjul = false; process.stdout.write("\n"); } resolve(String(l).trim()); };
    if (linjer.length) svar(linjer.shift()); else venter.push(svar);
  });
}
const lukSpoerg = () => { if (rl) rl.close(); };

function dansk(e) {
  const m = String(e?.message ?? e);
  // Serverens egen (danske) besked vises som den er; kun en ren HTTP-kode oversættes.
  if (e?.fraServer) return /^HTTP 40[13]$/.test(m) ? "Du har ikke adgang endnu. Casper skal give dig adgang i Admin → Claude-adgang." : m;
  if (/invalid login credentials/i.test(m)) return "Forkert e-mail eller kodeord. Kør login igen.";
  if (/invalid totp|invalid mfa|code.*(invalid|expired)/i.test(m)) return "Forkert eller udløbet kode fra to-faktor-appen.";
  if (/email not confirmed/i.test(m)) return "Din e-mail er ikke bekræftet. Spørg Casper.";
  if (/rate limit|too many|for security purposes/i.test(m)) return "For mange forsøg. Vent et par minutter, og prøv igen.";
  if (/fetch failed|enotfound|econnrefused|network/i.test(m)) return "Ingen forbindelse. Tjek internettet, og prøv igen.";
  if (/nødstop|disabled/i.test(m)) return "Casper har slået Claude-adgangen fra lige nu.";
  if (/forbidden|403/i.test(m)) return "Du har ikke adgang endnu. Casper skal give dig adgang i Admin → Claude-adgang.";
  return m;
}
const erForkertKode = (e) => /invalid totp|invalid mfa|code.*(invalid|expired)/i.test(String(e?.message ?? e));

try {
  const email = await spoerg("E-mail: ");
  const password = await spoerg("Kodeord: ", true);
  const s1 = await auth("/token?grant_type=password", { email, password });
  const factor = (s1.user?.factors ?? []).find((f) => f.factor_type === "totp" && f.status === "verified");
  if (!factor) throw new Error("Din konto har ikke to-faktor slået til. Slå det til i Admin først.");
  let s2 = null;
  for (let forsoeg = 1; forsoeg <= 3 && !s2; forsoeg++) {
    const code = (await spoerg("Kode fra to-faktor-appen (6 cifre): ")).replace(/\s/g, "");
    try {
      const challenge = await auth(`/factors/${factor.id}/challenge`, {}, s1.access_token);
      s2 = await auth(`/factors/${factor.id}/verify`, { challenge_id: challenge.id, code }, s1.access_token);
    } catch (e) {
      if (!erForkertKode(e) || forsoeg === 3) throw e;
      console.error("✗ Forkert kode. Vent på en ny kode i appen, og prøv igen.");
    }
  }
  if (aal(s2.access_token) !== "aal2") throw new Error("Login gav ikke to-faktor-niveau (aal2).");

  let svar;
  try {
    svar = await mcp("/login", { refresh_token: s2.refresh_token, device: os.hostname().slice(0, 100) }, s2.access_token);
  } catch (e) {
    throw Object.assign(new Error(e.message), { fraServer: true });
  }
  gemNoegle(svar.key, svar.expires_at);
  sletGammelSession();
  const udloeb = svar.expires_at
    ? new Date(svar.expires_at).toLocaleDateString("da-DK", { timeZone: "Europe/Copenhagen", day: "2-digit", month: "2-digit", year: "numeric" }).replaceAll("/", ".")
    : "om 14 dage";
  console.log(`✓ Logget ind som ${email}. Gyldig til ${udloeb} — sæt en påmindelse i din kalender.`);
  lukSpoerg();
  console.log("  Gå tilbage til Claude Code: skriv /mcp → alekos → Reconnect (eller Developer: Reload Window).");
} catch (e) {
  lukSpoerg();
  console.error(`✗ Login mislykkedes: ${dansk(e)}`);
  process.exit(1);
}
