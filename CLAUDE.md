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
