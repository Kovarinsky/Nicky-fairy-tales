# Nickyho pohádky — audit ceny, rychlosti a konkurence

Datum: 13. 8. 2026  
Rozsah: produkční agregáty, `main` (`6cb2c2d`), handoff, `ECONOMY-PLAN.md`, aktuální veřejné ceníky a konkurenční produkty.

## Executive summary

**Cíl 10 slidů / do 5 minut je realistický. Cíl kolem 5 Kč je s dnešní architekturou nemožný, i kdyby nebyla jediná oprava ani chyba.** Jeden nový 1K obrázek Gemini 3.1 Flash stojí $0,067; deset obrázků tedy stojí přibližně 14,1 Kč při dnešním kurzu, ještě před scénářem a hlasem. Řešením není další ladění retry parametrů, ale změna jednotky generování: místo deseti samostatných obrázků vyrábět jeden 4K storyboard o devíti panelech a obálku znovu použít z nejsilnějšího panelu, případně přidat nejvýše jeden samostatný 1K „hero“ obrázek.

Realistický produkční cíl při zachování Gemini 3.1 Flash Image:

- **Varianta A, doporučená:** 1× 4K storyboard = 9 dějových panelů, obálka je výřez stejného panelu. Odhad přímých AI nákladů **5–7 Kč**, P50 2–3 min, P95 pod 5 min.
- **Varianta B, konzervativnější:** 1× 1K hero + 1× 4K storyboard. Obraz stojí sám o sobě 4,58 Kč; se scénářem a hlasem je realistických **6,5–9 Kč**.
- **Dnešní cesta:** průměr produkce je přibližně **28,7 Kč jen za Gemini obrázky na jednu pohádku** napříč různými délkami. Průměrná příprava je 6:06, poslední běh 7:00.

Nejdřív je nutné opravit měření a účtování. Současná telemetrie zdvojuje znaky hlasu, kreditní účtování při self-chainu podhodnocuje obrázky a cenový model používá špatnou cenu 4K archu i hlasu. Bez opravy nelze spolehlivě vyhodnotit žádný experiment.

## 1. Co říká produkce

Anonymní agregát `/api/usage?days=30` dne 13. 8. 2026:

| Metrika | 30 dní | Na pohádku |
|---|---:|---:|
| Pohádky | 148 | — |
| 1K obrazová volání | 2 850 | 19,26 |
| 4K archy | 75 | 0,51 |
| Gemini image náklad | $202,28 | $1,367 / cca 28,7 Kč |
| Změřená doba přípravy | 141 běhů | průměr 366 s |
| Poslední doba | — | 420 s |
| Minimum / maximum | — | 37 s / 2 870 s |

Poznámky:

- `$202,28` zahrnuje pouze Gemini obrázky, nikoli Claude ani Gemini/ElevenLabs TTS.
- Počet `chars` nelze použít pro přesný TTS náklad. Job zapisuje celý scénář jednou při dokončení a `/api/scene` znovu každou skutečně namluvenou scénu. U kompletní pohádky jsou tedy znaky typicky započítané dvakrát.
- Bez distribuce počtu slidů nelze průměr 28,7 Kč přepočíst na přesnou cenu desetistránkové pohádky. Pro rozhodnutí to ale stačí: téměř 20 placených 1K generací na pohádku je dominantní problém.

### Matematická spodní hranice

Aktuální oficiální Gemini 3.1 Flash Image ceny jsou $0,067 za 1K a $0,151 za 4K obrázek.

| Obrazová strategie pro 10 slidů | Cena obrazu | Přibližně Kč |
|---|---:|---:|
| 10 samostatných 1K obrázků | $0,670 | 14,08 Kč |
| 2× 4K arch | $0,302 | 6,34 Kč |
| 1× 1K hero + 1× 4K arch | $0,218 | 4,58 Kč |
| 1× 4K arch, obálka znovu použitá | $0,151 | 3,17 Kč |

Z toho plyne:

1. Deset čerstvých obrázků nemůže stát celkem 5 Kč bez změny modelu nebo dotace.
2. Ani dva 4K archy nesplní 5 Kč, protože samotný obraz stojí přes 6 Kč.
3. Jediná cesta blízko 5 Kč při zachování Gemini 3.1 Flash je **jeden 4K výstup na celou pohádku**, velmi nízká míra placených oprav a krátká narace.

## 2. Nálezy v implementaci

### Kritické — opravit před experimenty

1. **Self-chain podhodnocuje cenu v kreditech.** `job-runner.ts` při dokončení posílá do `actualStoryCostCredits()` pouze `madeImages()` a `madeSheets()` z aktuální invokace. Správně má použít `totalImages1k()` a `totalImages4k()`, které zahrnují předchozí řetězy. Usage log je sčítá správně, účet uživatele ne.

2. **TTS znaky jsou v agregátu dvojmo.** Dokončení jobu zapisuje `voiceChars` jako součást story recordu, přestože hlas ještě vyrábí klient přes `/api/scene`; ten pak zapíše znaky podruhé. Je nutné oddělit `plannedNarrationChars` od `billedTtsChars`.

3. **Cenový model hlasu neodpovídá skutečné trase.** `actualStoryCostCredits()` vždy počítá $0,24/1 000 znaků, ale default je Gemini TTS, které se účtuje podle délky audia/tokenu. ElevenLabs Flash/Turbo je dnes $0,05/1 000 znaků. Každý TTS záznam musí obsahovat provider, model a skutečné usage.

4. **4K arch je v `pricing.ts` oceněn na $0,201 místo oficiálních $0,151.** Kredity se tím u archů nadhodnocují o 33 %.

5. **Claude cena se po 31. 8. chybně zvýší.** Kód stále očekává konec úvodní ceny Sonnet 5 a přepne z $2/$10 na $3/$15 za MTok. Anthropic 10. 8. oznámil, že $2/$10 zůstává standardní cenou.

6. **Google spend cap neobsahuje Gemini TTS.** `monthToDateGeminiUsd()` sčítá jen image usage, i když defaultní hlas se účtuje ve stejném Google projektu. Pojistka proto není pojistkou celého Google účtu.

7. **`/api/usage` zveřejňuje provozní náklady a stav ElevenLabs účtu bez autentizace.** Detail je chráněný heslem, souhrn ne. Přesunout celý endpoint pod admin session/roli.

### Vysoká priorita — cena a latence

1. **Archový režim má nejlepší možný obrazový účet vyšší než cíl.** První scéna se vždy kreslí sólo a `IMAGE_SHEET_MAX_REAL_PANELS` je defaultně 6. Deset slidů tak i při 100% úspěchu typicky potřebuje 1× 1K + 2× 4K = $0,369, tedy 7,75 Kč jen za obraz.

2. **Sheet QA je přísnější než solo QA.** Sólo scéna s 1–2 lidmi toleruje MODERATE nález. Panel archu nikoli: pokusí se o placený edit a pokud není úplně čistý, zahodí ho do placeného sóla. Stejná kvalitativní politika musí platit pro obě cesty; opravovat pouze MAJOR vady.

3. **Editace není levnější než nové kreslení.** `editSceneImage()` stojí další image generation. Je vhodná pro zachování kompozice, ale sama o sobě neřeší ekonomiku. U archu se vyplatí jen tehdy, pokud prokazatelně zachrání panel častěji než sólo redraw; jinak zvyšuje cenu o edit i následné sólo.

4. **Druhé kolo celého archu může násobit cenu a latenci.** Pokud první arch projde jen částečně, pipeline může generovat druhý arch a potom ještě sólo scény. Doporučený produkční budget je jeden 4K pokus + nejvýše jedna sólo MAJOR oprava na celou pohádku.

5. **TTS orchestrace je závislá na otevřeném klientovi.** Server dokončí obrázky; audio prefetch spouští polling v `page.tsx`. Zavřený nebo uspáný telefon nevyrobí hlas včas. TTS má být serverový, durable krok spuštěný po dopsání scénáře a běžet paralelně s obrazem.

6. **„Hotovo s chybějícími scénami“ odporuje kvalitativnímu cíli.** Po globálním deadline se job označí jako done i s chybějícími obrázky. Pro produktovou kvalitu je lepší explicitní stav `needs_repair` nebo kontrolovaný fallback, ne tiché dokončení.

7. **Chybí per-job ledger.** Z názvů Blob souborů nelze zjistit provider/model, počet retry, QA důvod, přesný TTS náklad ani vazbu samostatných audio záznamů na pohádku. Nelze počítat P50/P95 cenu ani zjistit, která pravidla QA pálí nejvíc peněz.

### Kvalita

Silná stránka appky je portrétová kartotéka, scale sheet, group anchor, uzavřený cast a QA. Tyto části bych nerušil. Problém je, že současná pipeline používá kvalitativní kontrolu jako opakovanou výrobu, ne jako selektivní bránu.

Kvalitu je vhodné definovat takto:

- MAJOR: jiná identita, chybějící/jiná postava, zásadně špatný věk/výška, jiný styl, ořez klíčového objektu — placená oprava.
- MODERATE: drobný outfit/odstín/doplněk bez změny identity — přijmout u 1–2 osob i u archu.
- MINOR: pouze logovat.
- Max. jedna placená oprava na pohádku v automatice; další opravy až na výslovný pokyn rodiče.

## 3. Doporučená cílová pipeline

### „One-sheet story“ pro běžnou desetislidovou pohádku

1. Claude vytvoří titul, stručný story bible a **9 dějových scén**, každou přibližně 250–300 znaků narace. Obálka používá kompozici/panel první nebo nejsilnější scény, ne nový obraz.
2. Portréty, scale sheet a group anchor se načtou paralelně jako dnes.
3. Jediné volání Gemini 3.1 Flash Image vytvoří 4K storyboard 3×3. Každá buňka po rozřezání vychází přibližně na rozlišení běžného 1K 16:9 panelu, takže nejde o degradaci pixelové kvality.
4. QA běží paralelně po panelech, ale placenou opravu spustí jen MAJOR nález. MODERATE se přijme podle stejné politiky jako solo scéna.
5. Maximálně jeden MAJOR panel se překreslí sólo. Pokud selžou dva a více panelů, job se označí pro ruční rozhodnutí; automaticky nevyrábí druhý celý arch.
6. Gemini TTS se spustí na serveru ihned po dopsání textu, paralelně s obrazem. Použije 3–4 souběžné requesty nebo jeden story-level request, pokud bude vyřešeno přesné dělení/timing.
7. Hotový arch je zároveň style anchor pro případnou línou opravu nebo pokračování.

### Proč to může kvalitu i zlepšit

- Postavy a paleta vznikají v jednom modelovém kontextu místo deseti nezávislých reinterpretací.
- Jeden obraz přirozeně drží styl a barevnost napříč panely.
- 4K/3×3 dává na panel zhruba stejné použitelné rozlišení jako dnešní 1K 16:9 výstup.
- Největší riziko není rozlišení, ale záměna castu mezi panely. To se testuje na fixní benchmark sadě a řeší panel-aware referencemi, které už appka má.

### Výjimky

- 3+ osoby v jednom panelu, custom postava bez schváleného portrétu nebo velmi složitý svět mohou použít „quality“ profil: 1× 1K hero + 1× 4K arch, případně 2× arch.
- Uživatel před startem vidí odhad ceny/profil: **Rychlá pohádka** vs. **Náročná rodinná pohádka**. Není vhodné všechny případy nutit do stejného budgetu.
- Vlastní postava nejprve dostane jednorázový schvalovaný portrét, který se uloží a amortizuje do dalších pohádek. Syrové fotky neposílat znovu do každé scény.

## 4. Plán implementace a měřitelné brány

### Fáze 0 — pravdivá data (1–2 dny)

- Zavést `job_cost_events`: `jobId`, provider, model, operation, resolution, input/output usage, durationMs, retry, QA outcome, estimatedUsd.
- Opravit sedm kritických bodů výše.
- Přidat per-job P50/P95 dashboard pro cenu a čas jednotlivých fází.
- Vytvořit fixní benchmark 12 příběhů: 1/2/4/7 postav, rodina, vlastní foto, vymyšlená postava, pes, pokračování, jednoduchý a složitý svět.

Gate: součet ledgeru se do ±5 % shoduje s vendor usage; žádné dvojité TTS znaky; self-chain se účtuje celý.

### Fáze 1 — levné změny bez redesignu (2–4 dny)

- Sjednotit lenient QA pro sólo a arch.
- Nastavit jeden archový pokus a jednu MAJOR opravu na pohádku.
- Pro 1–2 postavy otestovat 9 reálných panelů v 3×3 archu.
- Zkrátit defaultní naraci na 250–300 znaků/scénu; delší text dát jako volitelný profil.
- Přesunout TTS prefetch na server a spouštět po scénáři paralelně.

Gate: P50 < 4 min, P95 < 6 min, obrazový náklad desetislidového benchmarku < 10 Kč, lidské MAJOR chyby nejsou horší než baseline.

### Fáze 2 — one-sheet prototyp (4–7 dnů)

- Nová feature flag `ONE_SHEET_STORY`.
- 9 dějových scén + znovupoužitá obálka; jeden 4K arch.
- Chronologické panely v jednom storyboardu, jedna vizuální bible a panel-aware cast.
- Blind A/B porovnání proti dnešní pipeline na stejných 12 zadáních; hodnotit identitu, kompozici, styl, čitelnost a celkovou preferenci.

Gate: P50 < 3 min, P95 < 5 min, medián 5–7 Kč, nejvýše 1 placená oprava, A/B kvalita není horší než baseline.

### Fáze 3 — řízený rollout (3–5 dnů)

- 10 % interních/admin jobů, potom 25 %, 50 %, 100 %.
- Automatický fallback pouze podle předem definovaných MAJOR pravidel, ne při každé nejistotě graderu.
- Denní alert na cost/story, repair rate, sheet pass rate, P95 latency a incomplete rate.

### Fáze 4 — až podle dat

- Knihovna opakujících se světů/pozadí a lokální kompozice postav může dál snížit cenu, ale nese riziko „vystřihovánkového“ vzhledu. Nedělat před one-sheet testem.
- LoRA/vlastní model nyní nedoporučuji. Přidá další vendor stack a provozní složitost dřív, než se využije nejlevnější cesta dostupná přímo v Gemini.
- Batch API s poloviční cenou není vhodné pro interaktivní pětiminutový SLA; je vhodné jen pro předgenerovanou knihovnu klasických pohádek.

## 5. Konkurenční mapa

Trh není prázdný. Generický produkt „AI napíše a ilustruje pohádku o dítěti“ už není dostatečné odlišení.

| Produkt | Co překrývá | Rychlost/cena uváděná produktem | Mezery vůči Nicky |
|---|---|---|---|
| PixiTale | Foto dítěte a hračky, konzistentní postavy, plná narace, paralelní pipeline, web/mobile | první příběhy zdarma; přesná cena nezjištěna | velmi blízký koncept; neověřena čeština, širší rodina a pokračování |
| HUSHIKO | 6 ilustrací, audio, karaoke, profily dítě/pet/toy/family | kompletní za 2–3 min, první zdarma | uvádí 8 jazyků bez češtiny; 6 obrazů, ne hluboká foto-identita celé rodiny |
| KidzTale | Foto dítěte, 12–16 stran, audio, PDF | asi 3 min; $5,99/příběh, balíčky levněji | převážně jeden hrdina; méně interaktivní zvukový zážitek |
| StoryMine | Foto, stejná tvář na 12 stranách, klon hlasu rodiče, PDF/print | preview asi 5 min; digitál $19 | jeden hlavní hrdina, jeden styl; vyšší cena, gift produkt |
| ToonyStory | Foto, konzistence, 8+ stran, video, PDF/print | kolem 5 min; od $9,99/měs., kredit za generaci/edit | silný přímý konkurent pro knihy; méně zaměřený na český bedtime reader |
| Wistale | Ilustrace, narace, zvýrazňování slov | $7,99/měs., každonoční story | předplatné a profilový produkt; foto-identita není hlavní claim |
| WonderTales | Ilustrované příběhy, klon hlasu, 17 jazyků, volby | délky 3/5/7 min | čeština a hluboká vícečlenná vizuální identita nejsou potvrzené |
| Bibio.cz | Český produkt, foto dítěte, 10–14 originálních konzistentních ilustrací | 299 Kč PDF, do hodiny; 990 Kč tisk | bez živé audio/karaoke/SFX čtečky; přímý lokální konkurent pro gift/PDF |
| Readmio | Čeština/slovenština, rodinné čtení, hudba a hlasem spouštěné SFX | freemium/subscription | kurátorovaná knihovna, ne dynamická foto-personalizace |
| Once Upon a Bot / Storytailor / Storywizard | Personalizované texty, ilustrace, audio, export, jazyky | freemium/subscription | starší nebo obecnější řešení, slabší důraz na konzistenci celé reálné rodiny |

### Produktové doporučení

**Nedoporučuji investovat jako hlavní diferenciaci do:** obecného generátoru textu, PDF exportu, tisku, jednoho dítěte ve foto-knize, běžného výběru hlasů nebo generického redesignu. To vše už nabízí více hráčů.

**Doporučuji stavět moat kolem:**

1. češtiny a přirozeného českého bedtime audia;
2. několika skutečných členů rodiny a mazlíčků v jedné scéně, ne jen jednoho dítěte;
3. dlouhodobé vizuální paměti postav a světů mezi pohádkami;
4. pokračování se stejným canonem;
5. interaktivní čtečky: karaoke, ambient, SFX a rodičovský/klonovaný hlas;
6. rychlosti „zadám při čištění zubů, do spaní je hotovo“;
7. transparentního soukromí dětských fotek a hlasu.

Nejbližší konkurenční benchmark pro produkt není jedna aplikace, ale kombinace: **PixiTale/ToonyStory konzistence + HUSHIKO rychlost/karaoke + Readmio český zvukový bedtime zážitek + StoryMine vlastní hlas**.

## 6. Rozhodnutí, která doporučuji teď

1. Schválit ekonomický cíl jako **5–7 Kč medián, maximálně 10 Kč P95 pro běžných 10 slidů**. Tvrdých 5 Kč je možné jen v one-sheet variantě bez drahé opravy; nemá být slib pro každý složitý rodinný příběh.
2. Zachovat Gemini 3.1 Flash Image a ověřit one-sheet formát; nepřepínat kvalitu modelu před testem architektury.
3. Na týden pozastavit další kosmetický redesign a nejprve opravit ledger + one-sheet prototyp. Rychlejší a levnější hotový výsledek je teď větší produktová hodnota než další UI vrstva.
4. Po A/B testu rozhodnout, zda je „10 slidů“ 1 obálka + 9 dějových scén. Toto malé produktové rozhodnutí je rozdíl mezi obrazovým základem 3,17 Kč a 4,58 Kč.
5. Před veřejným rozšířením doplnit admin auth, role, privacy retention a tvrdé cost limity per job/provider.

## Zdroje

- Google Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini 3.1 Flash Image model: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image
- Gemini TTS: https://ai.google.dev/gemini-api/docs/speech-generation
- Anthropic Claude pricing: https://docs.anthropic.com/en/docs/about-claude/pricing
- ElevenLabs API pricing: https://elevenlabs.io/pricing/api
- PixiTale: https://pixitale.app/
- HUSHIKO: https://hushiko.com/
- KidzTale: https://kidztale.com/
- StoryMine: https://storymine.app/
- ToonyStory: https://toonystory.com/ and https://toonystory.com/pricing
- Wistale: https://www.wistale.com/pricing
- WonderTales: https://www.wondertales.app/
- Bibio: https://bibio.cz/
- Readmio context: https://www.expats.cz/czech-news/article/this-clever-multilingual-app-brings-czech-slovak-and-english-stories-to-life
- Once Upon a Bot: https://onceuponabot.com/
- Storytailor: https://www.storytailor.com/
- Storywizard: https://www.storywizard.ai/

## Omezení auditu

- Nebyl spuštěn nový placený produkční benchmark, aby audit sám negeneroval náklady.
- Detailní `/api/usage?stories=1` je chráněný admin heslem; audit nepoužil obcházení této ochrany.
- Konkurenční rychlost, cena a claimy jsou veřejná tvrzení produktů, ne nezávislý hands-on test jejich placeného výstupu. Před větší produktovou investicí doporučuji koupit a slepě porovnat 4 nejbližší produkty na jednom identickém zadání.
