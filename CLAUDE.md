# Nickyho pohádky — kontext projektu

Osobní AI storytelling appka (Next.js 15 + React 19 + TS, CSS Modules,
žádný Tailwind). Rodič vyplní formulář → Claude napíše scénář → Gemini
nakreslí ilustrace s konzistentním hrdinou (fotky reálných dětí/mazlíčků)
→ ElevenLabs namluví česky → interaktivní "knížka".

## Kde je co zapsané

- **`lib/version.ts`** — changelog už HOTOVÝCH změn (newest first), detailní
  Czech komentáře s odůvodněním. Čti to jako historii rozhodnutí.
- **Tento soubor** — DNA appky: produktové principy + rozhodnutá, ale ještě
  NEIMPLEMENTOVANÁ zadání (aby se neztratila mezi sezeními/agenty). Jakmile
  se položka odsud implementuje, přesune se jako záznam do `lib/version.ts`
  a tady se smaže.
- **`ECONOMY-PLAN.md`** — 2026-08-06 zadání „5 stran <3min/7,5Kč, 10 <4min/10Kč,
  15 6-7min/15Kč, cca 1 Kč/stránka" + „zamčená knihovna postav" architektura.
  Research + plán, ČEKÁ na schválení směru (hlavně jak agresivně jít do
  znovupoužívání pozadí/póz místo čerstvé ilustrace na každé stránce — mění
  to vizuální identitu appky, viz dokument bod 3/6) — NEIMPLEMENTOVÁNO.

## Produktové principy (DNA)

- **Personalizace je dnes vždy zapnutá a nejde vypnout.** `app/api/story/route.ts`
  vždy vloží obsazení postav do scénáře — pokud uživatel nevybere nikoho,
  appka nenačte tradiční postavy pohádky (Karkulka/vlk/babička), ale CELOU
  rodinnou knihovnu (`loadCharacters()`); jen bez jediné uložené postavy
  spadne na obecné "Hrdina/a young child". `lib/folk-tales.ts` u klasických
  pohádek (34 ks) drží jen 1–3větý `prompt` (nálada/děj jako inspirace pro
  Clauda), NE hotový skeleton příběhu ani kanonické obsazení — každé
  generování je psané od nuly.
- **Nic se negeneruje předem.** Scénář+ilustrace+namluvení vznikají on-demand
  při každé objednávce (~5–6 min, blíží se Vercel 5min limitu, proto
  `/api/job/continue` resume). Žádná knihovna hotových pohádek v projektu
  neexistuje. `app/s/[id]` jen republikuje JIŽ vygenerovanou konkrétní
  pohádku (sdílení), nejde o katalog.
- **CD (Claude Design)** je zdroj vizuálních redesignů, exportuje `.dc.html`/
  React komponenty do `design-bundle-vN` větví (staging, nic se nenapojuje
  do `main` automaticky). `design-bundle-v7` už obsahuje `StoryWorldStep`,
  `StoryDetailsStep`, `ReaderScreen` (s `sentIdx`/`wordIdx` state pro
  karaoke) a další — použít jako základ, ne stavět od nuly.

## Rozhodnuto, čeká na implementaci

### 1. Redesign story-creation flow (StoryWorldStep/StoryDetailsStep/Reader)
Rozhodnuto v designové session (2026-07-28):
- **Flow**: 4 kroky — Svět → Detaily (jméno/věk/postavy+pohlaví/hlas/počet
  stran, vše na jedné obrazovce) → Generování → Čtečka. Nahrazuje současný
  jednostránkový scrollovací formulář, žádná funkcionalita se neztrácí.
- **Postava**: přidat strukturované pole pohlaví + krátký popis vzhledu
  (chips/select), navíc k volnému textu `heroDescription`, ne místo něj.
- **Počet stran**: zachovat 3–20 / tlačítka −/+ (beze změny, jen nový vizuál).
- **Generování**: cíl max 5 min (300 s) na scénář+ilustrace+namluvení
  dohromady. Loading hlášky: mix — pohádkově-hravé + malý věcný progress
  indikátor pod nimi. **Pozor:** dnešní reálné běhy už občas narážejí na
  Vercel 5min limit → tenhle cíl může vyžadovat i optimalizaci/paralelizaci
  backendu při generování ilustrací, ne jen kalibraci UI.
- **Čtečka**: přidat karaoke zvýrazňování čteného textu (word-level timing
  z ElevenLabs, zatím nikde neimplementováno — `design-bundle-v7`
  `ReaderScreen.tsx` má na to připravený state, ale ne napojení na skutečné
  audio). Navigace: šipky + scrubber + swipe + auto-advance po dokončení
  namluvení stránky.
- Ilustrace pro `StoryWorldStep` (9 franšízových světů + 34 klasických
  pohádek) generuje CD do `assets/svety/`, `assets/katalog/` — potřeba
  finální rozlišení ≥1200px na delší straně (`assets/katalog/big/` apod.),
  ne jen 200×200/560×940 náhledy.

### 2. "Poslechnout v originále" — kanonický režim beze změny
Uživatel na kartě klasické pohádky (StoryWorldStep, katalog, ne u vlastních
světů) může zvolit poslech beze změny — bez vkládání rodinných postav,
s tradičním obsazením dané pohádky (Karkulka/vlk/babička apod.), ne s
vlastní rodinou jako hrdiny.

Co to vyžaduje (žádný z těchto kroků není hotový):
- **Data**: `lib/folk-tales.ts` — doplnit ke každé pohádce kanonické
  obsazení (jména/popisy tradičních postav), aby bylo co vložit místo
  rodinné knihovny.
- **Backend**: `buildUserPrompt` (`lib/claude.ts`) — nový `canonical: true`
  mód, který obsazení postav nahradí tradičním castem místo
  `req.characters`/`customCharacters`. `app/api/story/route.ts` musí tenhle
  flag přijmout a NEsáhnout na `loadCharacters()`/rodinnou knihovnu, když je
  zapnutý.
- **UI**: tlačítko/přepínač "Poslechnout v originále" na kartě pohádky v
  `StoryWorldStep` — zahrnout do CD briefu jako další stav karty.
- **Otevřené rozhodnutí (zatím NEuzavřeno)**: běží to pořád on-demand
  (~5–6 min čekání jako běžná pohádka), nebo se pro těchto 34 kanonických
  verzí vytvoří skutečná předgenerovaná knihovna (hotové ilustrace+audio,
  okamžité přehrání)? Předgenerovaná knihovna = jednorázový generovací
  náklad + úložiště, ale nulové čekání pro uživatele. Rozhodnout před
  implementací.

### 3. Portrét + ověření pro VLASTNÍ (uživatelem zadané) postavy
Rozhodnuto v session 2026-08-06, po opravě rodinné knihovny (`lib/portraits.ts`,
viz `lib/version.ts` 4.99.66–4.99.77): stejný mechanismus („namaluj portrét →
ověř → zamkni → z něj kresli všechny další stránky"), co dnes večer vyřešil
opakovaný drift u Jana a proporční chyby u Archieho/Váji, se má rozšířit i na
vlastní postavy zadané rodičem — dnes ho NEMAJÍ vůbec.

**Zjištěný stav (kód, ne dohad):**
- `CustomChar` (`app/page.tsx`) má jen `name` + volný text `description` + až
  5 fotek — žádné strukturované pole věk/pohlaví/výška (to je i položka 1 výš).
- **Žádný malovaný portrét ani zamčení podoby**: `lib/portraits.ts`
  (`getCharacterPortrait`/`loadPortraitRefs`) pracuje výhradně s pevnou
  9člennou knihovnou (`loadCharacters()`, `reference/characters.json`).
  Vlastní postavy jedou paralelní, jednodušší cestou —
  `customCharacterImages` (`job-runner.ts`) posílá SYROVÉ fotky do KAŽDÉ
  scény znovu, model je nezávisle reinterpretuje pokaždé — přesně ten bug,
  co appka dnes večer opravila u Jana ("vypadá zase trochu jinak"), jen u
  vlastních postav zůstává neopravený.
- **Žádná verifikace předem**: appka nemá žádný preview/portrét krok před
  spuštěním scénáře — první ilustrace, kterou rodič uvidí, je rovnou scéna 1
  SKUTEČNÉ, placené pohádky.
- **Bonus nález**: 2+ vlastní postavy ve stejné pohádce dostanou fotky
  smíchané do jedné neroztříděné hromady s obecným labelem
  `"a custom story character"` (`job-runner.ts`) — model neví, které fotky
  patří ke komu.
- `castSize` (gating pro "archy"/sheet economy mód) už dnes VLASTNÍ postavy
  počítá — 2+ vlastní postavy snadno spustí `castSize >= 4` a appka přeskočí
  levnější sheet mód, každá scéna jede draze sólo (`job-runner.ts`).

**Navržený mechanismus (odlehčená verze dnešního výškového listu, ne celý
list s pravítkem — to je overkill pro typicky 1 vlastní hrdinu):**
1. Při zadání vlastní postavy appka JEDNOU namaluje její portrét (stejný
   QA+best-of-2 mechanismus jako `getCharacterPortrait`).
2. Pokud jde do stejné pohádky s rodinnými/dalšími vlastními postavami, přidá
   malý porovnávací obrázek jen těch postav, co se v TÉTO pohádce potkají
   (mini verze dnešního výškového listu, na míru obsazení).
3. Ukázat rodiči jako rychlé "vypadá to takhle dobře?" PŘED spuštěním celého
   (5–6minutového, placeného) generování pohádky.
4. Všechny další stránky kreslí z tohoto zamčeného portrétu (ne ze syrové
   fotky znovu) — čeká se zlepšení konzistence napříč knihou + vedlejší efekt
   snížení počtu zamítnutí kontrolou (= mírná úspora).

**Cena**: +1 Gemini obrázek + 1 kontrola navíc na začátku každé pohádky
s vlastní postavou (pár vteřin, pár korun) — třeba zvážit proti cíli
ECONOMY-PLAN.md (~1 Kč/stránka).

### 4. Oddělit vývojářský (Jan) login od běžných uživatelů

Rozhodnuto v session 2026-08-07: "Nezapomeň že chci rozdělit můj —
developerský login a loginy všech ostatních uživatelů (ti neuvidí logy /
statistiky / errory atd.)." NEIMPLEMENTOVÁNO — jen zapsáno, ať se neztratí.

**Zjištěný stav (kód, ne dohad):** appka dnes nemá ŽÁDNÝ koncept role/účtu
s právy (`lib/accounts.ts` → `AccountRecord` nemá `isAdmin`/`role` pole,
jen `username`/`credits`/`storiesCompleted`). Tři endpointy dnes ukazují
citlivá data:
- **`GET /api/usage`** (skutečná útrata za AI služby) — **ÚPLNĚ BEZ
  AUTENTIZACE**, kdokoli se znalostí URL vidí reálné náklady appky.
- **`GET /api/job/debug-log?id=`** (diagnostický log běhu) — **ÚPLNĚ BEZ
  AUTENTIZACE**, jen chráněno tím, že `id` je UUID (bezpečnost skrze
  neprůhlednost, ne skutečná kontrola přístupu).
- **`GET /api/admin/accounts`** a **`GET /api/client-error`** (přehled
  účtů / chybové reporty) — chráněné, ale sdíleným statickým heslem v env
  (`ADMIN_PASSWORD` v hlavičce `X-Admin-Password`), NE navázané na Janovo
  přihlášení — kdokoli se heslem prolomí, ne jen "Jan vs. zbytek rodiny".

**Navržený mechanismus:**
1. Přidat `isAdmin: boolean` (nebo `role: "admin" | "user"`) do
   `AccountRecord` — nastavit `true` jen pro Janův účet (ručně/migrací).
2. `/api/usage` a `/api/job/debug-log` přesunout ze "žádná kontrola" na
   stejnou session-cookie kontrolu jako `/api/job/start`
   (`verifySessionToken`), + navíc vyžadovat `acc.isAdmin === true`.
3. `/api/admin/accounts` a `GET /api/client-error` — buď zachovat
   `ADMIN_PASSWORD` jako dnes (jednodušší, appka na ně nemá žádné UI, jen
   ruční/CLI přístup), nebo sjednotit na stejnou `isAdmin` kontrolu jako
   výš, ať appka drží JEN jeden mechanismus místo dvou paralelních.
4. V UI appky (pokud/až bude existovat nějaký admin panel — dnes žádný
   není, jen holé API endpointy) skrýt jakýkoli odkaz na logy/statistiky
   pro `isAdmin !== true`.
