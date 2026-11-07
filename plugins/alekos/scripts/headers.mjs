#!/usr/bin/env node
// Claude Codes "headersHelper" for Alekos-MCP'en.
// Fra 0.5.0 (21.10.2026) logger man ind via browseren: /mcp → alekos → log ind → Admin-siden "Forbind Claude".
// Claude Code gemmer og fornyer selv det login. Denne fil sender KUN en nøgle fra nødvejen (login.mjs i Terminal),
// mens den er gyldig. Ellers skriver den {} — så bruger Claude Code sit eget browserlogin.
// Aldrig et Supabase-token.
import { hentNoegle } from "./faelles.mjs";

const key = hentNoegle();
process.stdout.write(JSON.stringify(key ? { Authorization: `Bearer ${key}` } : {}));
