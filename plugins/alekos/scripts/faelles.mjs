// Fælles for login.mjs og headers.mjs. Kun MCP-nøglen (amcp_…) ligger i Mac'ens nøglering (Keychain),
// aldrig en Supabase-session og aldrig en fil i repoet. Kun den offentlige (publishable) nøgle står her.
//
// Fra 0.5.0 (21.10.2026) logger man ind via browseren (Claude Codes eget MCP-login). login.mjs er kun en NØDVEJ:
// dens nøgle gemmes med udløbsdato under sin egen konto i nøgleringen ("plugin-noedvej"), og headers.mjs sender den
// kun, mens den er gyldig — ellers intet, så Claude Code selv starter browserloginet (en Authorization-header fra
// headersHelper slår ellers Claude Codes eget login fra). Egen konto, så en anden Alekos-MCP-nøgle på samme Mac
// (fx Caspers) aldrig bruges af pluginet.
import { execFileSync } from "node:child_process";

export const SUPABASE_URL = "https://rufnmcnhebhzhzzgljcs.supabase.co";
export const PUBLISHABLE_KEY = "sb_publishable_xewSrVqiciDA9Qhtg2nXVg_bsWmgvQM";
export const MCP_URL = `${SUPABASE_URL}/functions/v1/alekos-mcp`;
const SERVICE = "alekos-mcp";
const KEY_ACCOUNT = "plugin-noedvej";
const OLD_SESSION_ACCOUNT = "session"; // fra den første udgave (Supabase-session) — slettes
const KEY_RE = /^amcp_[A-Za-z0-9_-]{43}$/;

/** Gemmer nøglen uden at den står i procesargumenterne (kommandoen sendes til `security -i` på stdin). */
export function gemNoegle(key, expiresAt) {
  if (!KEY_RE.test(key)) throw new Error("Serveren gav ikke en gyldig MCP-nøgle.");
  const udloeb = Date.parse(expiresAt);
  if (!Number.isFinite(udloeb)) throw new Error("Serveren gav ingen udløbsdato.");
  const vaerdi = `${key}|${new Date(udloeb).toISOString()}`;
  execFileSync("/usr/bin/security", ["-i"], {
    input: `add-generic-password -U -s ${SERVICE} -a ${KEY_ACCOUNT} -w "${vaerdi}"\n`,
    stdio: ["pipe", "ignore", "ignore"],
  });
  if (hentNoegle() !== key) throw new Error("Kunne ikke gemme nøglen i nøgleringen.");
}

/** Nødvejens nøgle, KUN mens den er gyldig (ellers null → browserlogin). */
export function hentNoegle(nu = Date.now()) {
  try {
    const out = execFileSync("/usr/bin/security", ["find-generic-password", "-s", SERVICE, "-a", KEY_ACCOUNT, "-w"], { timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    const [key, udloeb] = out.split("|");
    if (!KEY_RE.test(key ?? "")) return null;
    const t = Date.parse(udloeb ?? "");
    return Number.isFinite(t) && t > nu ? key : null;
  } catch {
    return null;
  }
}

function slet(account) {
  try {
    execFileSync("/usr/bin/security", ["delete-generic-password", "-s", SERVICE, "-a", account], { stdio: "ignore" });
  } catch { /* fandtes ikke */ }
}
export const sletNoegle = () => slet(KEY_ACCOUNT);
export const sletGammelSession = () => slet(OLD_SESSION_ACCOUNT);

export async function auth(path, body, token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method: "POST",
    headers: {
      apikey: PUBLISHABLE_KEY,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.msg || data.error_description || data.message || `HTTP ${res.status}`);
  return data;
}

/** Kald MCP'ens login/logout. */
export async function mcp(path, body, bearer) {
  const res = await fetch(`${MCP_URL}${path}`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export function aal(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).aal ?? null;
  } catch {
    return null;
  }
}
