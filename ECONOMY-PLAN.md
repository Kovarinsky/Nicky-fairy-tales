# Cena/kvalita/rychlost — cílený research a plán (2026-08-06)

Zadání (2026-08-05 večer): appka má trvale dosahovat
**5 stran < 3 min / 7,5 Kč · 10 stran < 4 min / 10 Kč · 15 stran 6-7 min / 15 Kč**
(defacto ~1 Kč/stránka), při zachování kvality, a navrhnout architekturu appky
tak, aby byla stabilní a ekonomická — konkrétně systém "zamčené" knihovny
postav, co se dá znovupoužívat mezi scénami/pohádkami.

Tenhle dokument je **výsledek researche a plán, ne hotová implementace**.
Žádný z návrhů níž ještě není v appce — čeká na tvoje schválení a pak na
mockup/testovací fázi (viz „Postup nasazení" dole), teprve pak main.

## 1) Kde doopravdy jsme vs. kde chceme být

Přepočítáno na **skutečné, dnes ověřené ceny** (ne appkou dřív odhadované — viz
oprava níž), z reálných dat z dnešních živých testů:

| Délka | Cíl (čas / cena) | Reálný odhad appky dnes (`estimateStoryCostCredits`) | Přepočet na Kč (bez marže) |
|---|---|---|---|
| 5 stran | <3 min / 7,5 Kč | ~33 kreditů | **~22 Kč** |
| 10 stran | <4 min / 10 Kč | ~60 kreditů | **~40 Kč** |
| 15 stran | 6-7 min / 15 Kč | 88-115 kreditů (podle úspěšnosti archů) | **~59-77 Kč** |

**Závěr č. 1: appka je dnes cca 3-5× nad cílovou cenou, napříč všemi délkami.**
Časy (dnešní živé testy, po opravách 4.99.47-4.99.52): 5 stran 102s ✅ (cíl
180s), 10 stran 223s ✅ (cíl 240s), 15 stran 287-348s ⚠️ (cíl 360-420s, u
velkých rodin ještě ne vždy kompletní) — **časový cíl je realistický a skoro
splněný**, cenový cíl vyžaduje **strukturální změnu**, ne doladění.

### Oprava cenového modelu appky (`lib/pricing.ts`)

Appčin vlastní komentář to už přiznává: *"SAZBY NÍŽE JSOU VÝCHOZÍ ODHAD, NE
ověřená aktuální fakturace"*. Dnes večer jsem ověřil u zdroje:

| Položka | Appka počítá s | Realita (ověřeno) | Rozdíl |
|---|---|---|---|
| ElevenLabs `eleven_multilingual_v2` | $0,24/1000 znaků | **$0,182/1000 znaků** (v rámci Creator plánu, $22/121 000 znaků) | appka to mírně přeceňuje — dobrá zpráva, ale malá |
| ElevenLabs Flash/Turbo model | nepoužívá se | **$0,091/1000 znaků — POLOVIČNÍ cena** (0,5 kreditu/znak místo 1) | appka nevyužívá nejlevnější dostupnou variantu |
| Gemini `gemini-3.1-flash-image` 1K | $0,067/obrázek | **potvrzeno správně** (ai.google.dev pricing) | OK |
| Gemini `gemini-3-pro-image` | appka nepoužívá | **$0,134/obrázek (1K/2K), $0,24 (4K)** — 2× cena flash | nová možnost, ne dnešní náklad |
| Claude psaní | $0,15 paušál/pohádka | **skutečně netrackováno tokeny** (`voiceChars = 0` bug v `job-runner.ts` už dřív zaznamenaný) | pravděpodobně nadhodnoceno — reálný odhad ~$0,05-0,09 při dnešní délce scénářů (8-11k znaků), ale BEZ SKUTEČNÉHO MĚŘENÍ je to jen odhad |

**Akce (levná, hned):** přepnout `ELEVENLABS_MODEL_ID` na Flash/Turbo variantu
místo `eleven_multilingual_v2` — **okamžitá úspora ~50 % na namluvení**, pokud
kvalita českého přednesu obstojí (nutno poslechem ověřit, ne předpokládat).
Druhá levná akce: appka skutečně metrovat Claude tokeny místo paušálu — dnes
appka neví, kolik psaní OPRAVDU stojí.

## 2) Klíčový poznatek — proč to nejde jen doladit

I v **nejlepším možném případě** (žádné QA redraw, žádné archy, jen 1×
sólo obrázek/scénu) vychází marginální cena na scénu:

```
obrázek (1K sólo):  $0,067
hlas (380 znaků):   $0,069  (opraveno na reálnou cenu)
= $0,136 / scénu, navíc $0,15-0,09 paušál na psaní jednou za pohádku
```

Cíl je ~$0,043/stránku (1 Kč ≈ $0,043). **Samotný jeden čerstvý obrázek
($0,067) už PŘEKRAČUJE celý stránkový rozpočet**, dřív než se připočte hlas
nebo psaní. To znamená: cíl **nejde splnit tím, že appka bude kreslit
stejným způsobem jako dnes, jen "efektivněji"** — model "jeden čerstvý,
originální obrázek na každou stránku" je cenově neslučitelný s 1 Kč/stránku,
ať se QA/archy/souběžnost vyladí sebelíp.

**Aby to vyšlo, většina stránek nesmí platit plnou cenu čerstvého
generování.** Musí se z něčeho už zaplaceného/ověřeného **znovupoužívat**.
Přesně tímhle směrem míří tvůj vlastní návrh (zamčená knihovna postav) — je
to správný instinkt, ne jen "hezčí UX", je to JEDINÁ cesta k cílové ceně.

## 3) Navržená architektura: Knihovna postav se "zámkem"

### Fáze 1 — Strukturovaný příjem nové postavy (ne volný text)

Appka dnes bere postavy hlavně jako volný `description` text
(`Character.description`, anglický popis pro image prompt). Návrh: při
přidání NOVÉ postavy appka provede **řízený dotazník** (ne prosté "napiš
popis"):
- Věk, pohlaví
- Barva/styl vlasů (z uzavřené nabídky barevných rodin — appka už má
  vlastní systém "color families" v QA promptu, `lib/gemini.ts:447`, jen ho
  použít i při VZNIKU postavy, ne jen při kontrole)
- Barva očí (stejně, uzavřená nabídka)
- Tón pleti
- Typická/signature outfit (co nosí "vždy")
- Rozlišující znak (brýle, pihy, čepice…)
- Relativní výška vůči ostatním knihovním postavám (appka má fixní
  výškovou tabulku pro kanonické postavy — `lib/job-runner.ts`
  `scaleSheet`/height list — nová postava se do ní musí explicitně zařadit)

Tohle přímo řeší i DNEŠNÍ nález (výškové poměry = #1 příčina selhání QA) —
strukturovaná výška při VZNIKU postavy znamená, že appka o ní nemusí dodatečně
"hádat" v každé scéně.

### Fáze 2 — Generování + validace reference (jednorázově, ne za pohádku)

Až appka strukturovaná data má, vygeneruje (a **appka i uživatel schválí**,
než se "zamkne"):
1. **Sólo portrét** postavy (dnešní stav, appka to už umí)
2. **Skupinová kotva** — postava zařazená DO SCÉNY s ostatními zamčenými
   postavami z knihovny, se správnými poměry výšek — `nová` položka
   (viz Varianta 1 z včerejšího návrhu). Generuje se JEDNOU za CELOU
   rodinu/knihovnu, ne za pohádku.
3. *(volitelně, dražší)* 2-3 další úhly (3/4, profil) — Varianta 6, jen
   pokud se ukáže, že sólo portrét + skupinová kotva nestačí.

Jednorázová cena na CELOU knihovnu (ne na pohádku!): u rodiny 4-5 lidí
~5-8 obrázků × $0,067 = **$0,34-0,54 jednou**, amortizováno napříč
DESÍTKAMI budoucích pohádek té rodiny → efektivně blízko nule na pohádku.

### Fáze 3 — "Zámek"

Jakmile je knihovní postava (portrét + skupinová kotva) schválená:
- appka ji označí jako `locked: true` v `reference/characters.json`
  (nové pole, appka dnes nemá koncept "locked" vs "draft")
- **zamčená postava se PŘI GENEROVÁNÍ SCÉNY NIKDY nepřekresluje od nuly** —
  vždy se do promptu vloží jako REFERENCE (appka to už dělá), ale NOVĚ: appka
  u zamčené postavy nedovolí `heroDescription` free-text přepsat její
  zamčené atributy (dnes teoreticky možné, kdyby vypravěč popsal postavu
  jinak, než je v kartotéce — appka pravidlo "co je v kartotéce má
  přednost" už částečně má, ale ne jako tvrdé pravidlo).

### Fáze 4 — Znovupoužití při psaní/kreslení scény

Tohle je místo, kde se skutečně šetří peníze. Dvě úrovně agresivity:

**A) Konzervativní (nízké riziko, menší úspora):** appka dál kreslí KAŽDOU
scénu čerstvě, ale s LEPŠÍ referencí (skupinová kotva navíc k portrétům) →
méně QA redrawů (dnešní hlavní skrytý náklad), ne méně obrázků. Odhad
úspory: redraw rate klesne, ale pořád 1 fresh obrázek/scéna → cena
nejspíš klesne z ~3,6 Kč/scéna na ~2,5-3 Kč/scéna. **Nestačí na cíl 1 Kč.**

**B) Agresivní (větší riziko/změna vzhledu appky, cílová úspora):** appka
u NĚKTERÝCH scén (ne titulní, ne klíčové "wow" momenty) **znovupoužije
existující pozadí z appčiny knihovny světů** (appka je má — `bg-*` z dnešní
hudební knihovny, `lib/backgrounds.ts`) + zamčenou postavu v jedné z
předschválených póz, a jen **editačním voláním** (Gemini podporuje
inpainting/editaci, appka to dnes nevyužívá vůbec) upraví detail scény
(gesto, výraz, malý rekvizit) — místo generování celého obrázku od nuly.

**Tohle je zásadní rozhodnutí, který appka udělá jinou appkou:** B) znamená,
že appka přestává být "každá stránka je 100% unikátní čerstvá ilustrace" a
stává se "appka skládá z ověřených, zamčených dílů + malých úprav". Nižší
cena, pravděpodobně nižší QA redraw rate (menší volnost = míň prostoru na
chybu), ale RIZIKO, že se pohádky budou vizuálně opakovat/cítit "skládaně",
ne pokaždé jako nová malba. **Tohle vyžaduje tvoje rozhodnutí, ne moje —
je to produktová identita appky, ne jen technický detail.**

## 4) Matice technik — co kombinovat

| Technika | Cenový dopad/stránku | Riziko kvality | Implementační náročnost |
|---|---|---|---|
| Skupinová kotva (Fáze 2) | nepřímý (míň redrawů) | žádné | nízká |
| Strukturovaný intake postavy | nepřímý (přesnější knihovna) | žádné | nízká-střední |
| ElevenLabs Flash/Turbo model | přímý, **-50 % na hlas** | nutno ověřit poslechem | nízká |
| Reálné měření Claude tokenů | přesnější rozpočet, ne nutně levnější | žádné | nízká |
| Odlehčené QA u 1-2 lidí scén | **-15-25 %** na těch scénách | nízké (appka i dnes tyhle scény zvládá spolehlivě) | nízká |
| Hybrid Pro model jen pro 3+ postavy | nejistý — možná cost-neutrální (míň redrawů) | žádné/pozitivní | střední |
| Znovupoužití pozadí + editace místo fresh-gen (B výš) | **největší, jediná reálná cesta k 1 Kč/stránku** | **vysoké — mění vizuální styl appky** | vysoká, potřeba prototyp |
| Víceúhlé reference postav | nepřímý | žádné | nízká, ale prodražuje Fázi 2 |

## 5) Postup nasazení — jak jsi žádal

1. **Tenhle dokument** → tvoje schválení směru (hlavně bod „Fáze 4B" — jak
   agresivně jít do znovupoužívání)
2. Nová branch `claude/economy-mockup` (ne `main`, ne dnešní pracovní
   branch) — jen pro tenhle experiment, ať se neplete do zbytku práce
3. Implementace v pořadí: (a) levné/bezriziková („ElevenLabs Flash",
   „skupinová kotva", „odlehčené QA") → (b) až po tvém odsouhlasení
   Fáze 4B, prototyp znovupoužívání pozadí+editace na 1-2 testovacích
   pohádkách
4. **Živé testy na mockupu** (stejný postup jako dnes — reálné pohádky
   5/10/15 stran, měřený čas i cena) — několikrát, ne jednou, ať je vidět
   rozptyl (dnešní testy ukázaly, že stejná délka může vyjít různě podle
   obsazení/QA štěstí)
5. **Tvoje ruční review** výsledných pohádek (kvalita ilustrací, ne jen
   čísla) — cena/rychlost jsou měřitelné, kvalita ne, tu musíš posoudit ty
6. Teprve po tvém souhlasu → merge do `main`

## 6) Otevřené otázky — potřebují tvoje rozhodnutí, ne můj odhad

- **Jak moc agresivně do Fáze 4B?** (viz bod 3 výš — mění to vizuální
  identitu appky)
- Je 1 Kč/stránka tvrdý cíl, nebo je prostor na kompromis (např. 1,5-2
  Kč/stránka), pokud by to znamenalo zůstat u čerstvé ilustrace na KAŽDÉ
  stránce (jen s levnějšími komponentami — hlas Flash, míň redrawů)?
- ElevenLabs Flash/Turbo — chceš, ať to nejdřív živě otestuju na kvalitu
  českého přednesu, než se přepne natvrdo?
- Skupinová kotva — kreslit ji pro STÁVAJÍCÍ rodinu (`reference/characters.json`,
  9 lidí) hned, nebo počkat na širší schválení celého plánu?

## 7) Co jsem NEudělal (a proč)

Žádné další placené živé testy dnes v noci — všechny dnešní testy (SFX,
5/10/15 scén, castSize opravy) proběhly s tebou u toho. Tohle je plán na
schválení, ne další útrata bez dozoru přes noc.
