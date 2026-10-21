# Alekos i Claude Code

Plugin til Alekos Rejsers kontor. Claude får adgang til Admin via Alekos' egen forbindelse **"alekos"**, med **dit eget
Admin-login og to-faktor** (koden fra appen på din telefon). Claude kan kun det, du selv kan i Admin, og Casper kan stramme det yderligere.
Alle kald logges, og Casper kan fortryde rettelser.

Pluginet opdaterer sig selv. Nye regler, værktøjer og ændret adgang kommer automatisk — du installerer kun én gang.

## 0. Før du starter

- **Casper giver dig adgang** i Admin → Claude-adgang. Uden det får du ingen værktøjer.
- **VS Code med udvidelsen Claude Code**, opdateret (Udvidelser → Claude Code → Opdater).
- **Åbn den mappe, du plejer at arbejde i**, i VS Code (Fil → Åbn mappe), fx `VS Code` i din hjemmemappe — aldrig hele
  hjemmemappen.

"Genstart" betyder i denne vejledning: i VS Code tryk **⌘ + Shift + P**, skriv **Developer: Reload Window** i feltet,
der åbner øverst, og tryk Enter.

## 1. Installation (én gang)

1. Skriv i skrivefeltet nederst i Claude Code (der hvor du skriver til Claude), og tryk Enter efter hver linje:
   ```
   /plugin marketplace add CasperAlekosDK/alekos-claude-plugin
   /plugin install alekos@alekos-intern
   ```
   Den første svarer, at markedspladsen er tilføjet, den anden, at pluginet er installeret. Spørger den om lov, så
   klik ja/installér. Virker kommandoerne ikke: skriv `/plugin`, vælg fanen **Marketplaces**, tilføj
   `CasperAlekosDK/alekos-claude-plugin`, find **alekos**, og vælg Installér. Ser det anderledes ud: ring til Casper.
2. **Genstart.** Nu får du beskeden "Alekos: sikkerhedsreglerne er sat …" (eller Claude siger det til dig).
3. **Genstart én gang til**, så sikkerhedsbeskyttelsen er slået til. Pluginet sætter selv reglerne — du skal ikke gøre
   noget i Terminal.

## 2. Log ind

1. Skriv `/mcp` i Claude Code og tryk Enter. Vælg **alekos** med piletasterne og Enter (der står måske
   "needs authentication"), og vælg **Authenticate** (log ind).
2. Browseren åbner Admin-siden **"Forbind Claude"**. Er du ikke logget ind i Admin, logger du ind som altid først.
3. Skriv den 6-cifrede kode fra appen på din telefon (den samme som ved Admin-login), og klik **Forbind**.
4. Browseren skriver "Authentication successful". Luk fanen, og gå tilbage til VS Code.

Claude Code fornyer selv loginet. Du skal kun logge ind igen efter 30 dage uden brug, eller hvis Casper logger dig ud.
Claude får aldrig dit Admin-login — kun en Alekos-nøgle, der virker én time ad gangen.

## 3. Test

Skriv til Claude: **"Kald værktøjet hvem_er_jeg"** (en test, der viser, at du er logget ind). Spørger Claude om lov,
så godkend. Svaret viser din e-mail, og hvad Claude må pr. område.
Prøv derefter fx: "Vis flyplanen for 131026".

## 4. Chrome til fly og Facebook

Claude in Chrome er tilladt, men **kun i en separat Chrome-profil, hvor du aldrig logger ind i Admin** (admin.alekos.dk),
Supabase eller Lovable.

1. Chrome → profilikonet øverst til højre → **Tilføj** → kald profilen **Alekos arbejde**.
2. Installér udvidelsen **Claude in Chrome** i den nye profil. Log ind på Facebook og flyselskaberne dér.
3. I din gamle profil (den med Admin): højreklik på Claude-udvidelsen → **Fjern fra Chrome**.
4. Log aldrig ind i Admin i "Alekos arbejde".

Hvorfor: i en profil med Admin-login ligger login-nøglen i browseren, og Claude kan køre JavaScript på siden. Så kunne
Claude gøre alt, du kan i Admin, uden om forslag, godkendelse og log. Sikkerhedsvagten blokerer desuden, at Claude
åbner admin.alekos.dk og andre alekos.dk-undersider (alekos.dk og www.alekos.dk er tilladt), Supabase og Lovable.

## 5. Rettelser i Admin

Claude laver først et **forslag** og viser før → efter. Intet gemmes, før du skriver "ja, gem" i chatten.
Derefter viser Claude Code sin egen godkendelsesboks. **Klik aldrig "altid tillad" ved gem** — godkend hver gang.
Casper kan fortryde enhver gemt rettelse.

## 6. Når det driller

- **"needs authentication" / ikke logget ind:** log ind igen (afsnit 2).
- **Casper har ændret din adgang:** `/mcp` → alekos → Reconnect, eller start en ny chat.
- **Ingen værktøjer:** Casper har slået Claude fra (nødstop), eller du har ikke fået adgang. Spørg ham.
- **"Blokeret af Alekos' sikkerhedsvagt":** Claude prøvede at røre noget, den ikke må. Det er meningen.
- **"Alekos: sikkerhedsreglerne er opdateret":** genstart VS Code-vinduet.
- **"Alekos: sikkerhedsreglerne kunne ikke sættes":** ring til Casper. Vagten virker stadig.
- **Claude Code vil ikke starte** ("sandbox required but unavailable"): sandkassen kan ikke starte på din Mac. Ring til Casper.
- **Internet i kommandoer:** første gang en kommando vil på et nyt domæne, spørger Claude Code dig. Kun Supabase er spærret.
- **En fil fra en mail:** gem vedhæftningen i Overførsler først, eller træk filen direkte ind i chatten.
- **Andre forbindelser** (Gmail, Outlook, Slack …) virker som i dag. Supabase, Dinero og Lovable slår Casper til/fra
  for dig i Admin. Værktøjer, der styrer filer, browser, terminal eller VS Code, er altid spærret.

## 7. Hvilken udgave har jeg?

`/plugin` → fanen **Installed** → **alekos** viser versionen. Nye udgaver hentes af sig selv og bruges fra næste genstart.

## 8. Log ud

`/mcp` → alekos → **Clear authentication**. Casper kan også logge dig ud alle steder fra Admin (Claude-adgang).

---

## Til Casper

**Test isoleret** (din egen `~/.claude` røres aldrig): `bash opsaetning/test-isoleret.sh --toerk` viser, hvad der
sker; uden `--toerk` installeres pluginet i `~/Alekos-plugintest` og Claude Code startes dér. Ryd op med `--slet`.
Opstartsreglen og `opsaetning/sikkerhed.mjs` nægter begge at ændre din `~/.claude` (også via link eller store bogstaver).

**Tests uden Claude Code:** `bash test/vagt-test.sh` (vagten) og `bash test/opstart-test.sh` (opstartsreglen). Begge
bruger falske mapper.

**Ny udgave ud:** ret, kør begge tests og `bash test/versionstjek.sh`, hæv `version` i `plugins/alekos/.claude-plugin/plugin.json`, commit og push til
`main`. Opstartsreglen henter den selv i baggrunden (højst én gang i timen, med Claude Codes egen `plugin update`), og
den bruges fra næste genstart. Claude Codes egen `autoUpdate` slås også til (den venter op til 10 min efter start). Fjerner du en sikkerhedsregel, skal den også i `FJERNEDE_REGLER` i `plugins/alekos/sikkerhed/regler.mjs`
(fletningen tilføjer ellers kun). Arbejdsregler, fagviden og adgang ligger på serveren og kræver ingen ny udgave.

**Nødveje:** `node plugins/alekos/scripts/login.mjs` (login i Terminal, hvis browserloginet ikke virker) og
`node opsaetning/sikkerhed.mjs` (sætter reglerne efter et "ja").

## Sikkerhed (hvad og hvorfor, ærligt)

Browseren har din Admin-session liggende. Kunne Claude læse den, kunne den gøre alt, du kan i Admin, uden om
MCP'ens grænser og log. Derfor er der flere værn, og hvert værn dækker noget forskelligt:

| Værn | Dækker | Hvor |
|---|---|---|
| **Deny-regler** | Claudes egne værktøjer (Read, Grep, Glob, Edit/Write, WebFetch): browser- og appdata i `~/Library`, nøglering, `~/.ssh`, `~/Hemmeligt`, `~/.config`, `~/.supabase`, `~/.aws`, `~/.docker`, nøglefiler og shell-historik, `.env`-filer, `*.supabase.co`, Claude Codes indstillinger, `.mcp.json`, pluginmappen, git-hooks og VS Code-opsætning (kode, der senere kører uden sandkasse), `open`/`osascript`. Gem i Admin kræver altid din godkendelse. | `settings.json`, sat af opstartsreglen (`plugins/alekos/hooks/opstart.mjs`, regler i `plugins/alekos/sikkerhed/regler.mjs`) |
| **Sandkasse** | Alt, Claude kører i Bash (også scripts): styresystemet nægter læsning af de samme mapper og skrivning i Claude Codes indstillinger og pluginmappen; `*.supabase.co` er nægtet. | samme |
| **Sikkerhedsvagt** | Andre forbindelser efter Caspers valg pr. person (hentet fra Alekos-serveren); værktøjer, der styrer filer/browser/terminal/editor, er altid spærret; Chrome-regler; stier og mønstre i alle filværktøjer og Bash. Fejler vagten, blokeres kaldet. | `plugins/alekos/hooks/vagt.mjs` |

Ærligt om grænserne:
- **For Bash er vagten kun et mønster-tjek og kan omgås.** Det reelle værn for Bash er sandkassen, og den er først
  aktiv efter genstart (derfor beskeden ved første start).
- Claude Code logger selv ind og fornyer; Claude får aldrig et Supabase-token, kun en kortlivet nøgle til de faste
  MCP-værktøjer. Serveren tjekker kontorrolle, to-faktor, adgang og nødstop ved hvert kald.
- **Chrome-værnet er profilen, ikke vagten.** Vagten kan ikke se alt, hvad JavaScript på en side gør.
- Plan-tilstand må skrive `*.md` direkte i `~/.claude/plans/`; resten af `~/.claude` er spærret.
- Har du brug for internet i Bash til noget bestemt, kan Casper tilføje domænet i `sandbox.network.allowedDomains`.
