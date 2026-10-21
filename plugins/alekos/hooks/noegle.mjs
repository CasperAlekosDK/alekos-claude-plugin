// Claude Codes eget Alekos-login (browserloginet, plugin 0.5.7 — Caspers ja 21.10.2026), til sikkerhedsvagten.
// Claude Code gemmer MCP-login i nøgleringen ("Claude Code-credentials", med en endelse ud fra CLAUDE_CONFIG_DIR) under
// mcpOAuth["plugin:alekos:alekos|…"]. Kun en gyldig, ikke-udløbet amcp_-nøgle bruges, og kun til at hente personens
// regler fra Alekos' egen server. Nøglen skrives aldrig nogen steder. Fejler noget: null (sidst kendte regler gælder).
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

const AMCP = /^amcp_[A-Za-z0-9_-]{43}$/;

/** Ren udvælgelse (testes uden nøgleringen): nyeste gyldige amcp_-nøgle for Alekos-pluginets server. */
export function vaelgAlekosNoegle(data, nu = Date.now()) {
  let bedst = null;
  const poster = data && typeof data === "object" && data.mcpOAuth && typeof data.mcpOAuth === "object" ? data.mcpOAuth : {};
  for (const [k, v] of Object.entries(poster)) {
    if (!k.startsWith("plugin:alekos:alekos|") || typeof v?.accessToken !== "string" || !AMCP.test(v.accessToken)) continue;
    const udloeb = Number(v.expiresAt) || 0;
    if (udloeb && udloeb - 30_000 <= nu) continue;
    if (!bedst || udloeb > bedst.udloeb) bedst = { key: v.accessToken, udloeb };
  }
  return bedst?.key ?? null;
}

/** Navnet på Claude Codes post i nøgleringen (samme regel som Claude Code 2.1.301). */
export function lagerNavn(env = process.env) {
  const dir = env.CLAUDE_CONFIG_DIR;
  return `Claude Code-credentials${dir ? `-${crypto.createHash("sha256").update(path.resolve(dir).normalize("NFC")).digest("hex").slice(0, 8)}` : ""}`;
}

export function claudeCodeNoegle(nu = Date.now()) {
  try {
    const bruger = process.env.USER || os.userInfo().username;
    const raa = execFileSync("/usr/bin/security", ["find-generic-password", "-a", bruger, "-s", lagerNavn(), "-w"], {
      timeout: 3000, stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    return vaelgAlekosNoegle(JSON.parse(raa), nu);
  } catch {
    return null;
  }
}
