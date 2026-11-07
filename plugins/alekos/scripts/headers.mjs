#!/usr/bin/env node
// Claude Codes "headersHelper" for Alekos-MCP'en.
// Fra 0.5.0 (21.10.2026) logger man ind via browseren: /mcp → alekos → log ind → Admin-siden "Forbind Claude".
// Claude Code gemmer og fornyer selv det login. Denne fil sender KUN en nøgle fra nødvejen (login.mjs i Terminal),
// mens den er gyldig. Ellers skriver den {} — så bruger Claude Code sit eget browserlogin.
// Aldrig et Supabase-token.
// 0.8.0: sender også X-Alekos-Plugin = pluginets udgave (fra dets egen plugin.json), så serveren kan kræve en ny nok
// udgave (fx ret_fagviden ≥ 0.8.0). Kan udgaven ikke læses, udelades headeren — headersHelper må aldrig fejle.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hentNoegle } from "./faelles.mjs";

const ud = {};
try {
  const v = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".claude-plugin", "plugin.json"), "utf8"))?.version;
  if (typeof v === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v)) ud["X-Alekos-Plugin"] = v;
} catch { /* uden udgave */ }
try {
  const key = hentNoegle();
  if (key) ud.Authorization = `Bearer ${key}`;
} catch { /* så bruger Claude Code sit eget browserlogin */ }
process.stdout.write(JSON.stringify(ud));
