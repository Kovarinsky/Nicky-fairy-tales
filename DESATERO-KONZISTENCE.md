# 🔟 Desatero konzistence obrázků

Deset pravidel, která musí platit na KAŽDÉM obrázku KAŽDÉ pohádky.
Stejný seznam je doslovně zapsaný ve vizuální kontrole (`lib/gemini.ts`,
`verifySceneImage`) — každý vygenerovaný obrázek se proti němu kontroluje
a při porušení se překresluje (2 opravná kola + 1 čerstvý pokus).

Kontrola běží NA SERVERU uvnitř `generateSceneImage` — platí tedy pro
všechna zařízení a všechny cesty generování (serverová fronta i lokální
pipeline v prohlížeči, obě volají stejnou funkci).

1. **Počet lidí = počet jmenovaných postav.** Na obrázku nesmí být nikdo
   navíc — žádní cizí lidé ani postavy v pozadí.
2. **Každá postava právě jednou.** Dvě podobné děti nebo dva podobní
   dospělí v jednom obrázku = vada (žádní „dva tátové").
3. **Barva vlasů dle kartotéky, postavu po postavě.** Blond zůstává blond,
   hnědá hnědá — platí i pro vymyšlené a vedlejší postavy.
4. **Délka a střih vlasů dle kartotéky.** Krátké zůstávají krátké, dlouhé
   dlouhé; vousy podle záznamu.
5. **Každý nosí SVOJE oblečení.** Podpisové oblečení na cizí postavě
   (jiné dítě v Nicolaskově bílém tričku s červenými pruhy) = vada.
   Převleky jen přes zamčený záznam „Story outfits:".
6. **Jednotná úroveň oblečení ve scéně.** Nikdo v bundě vedle někoho
   v tričku; uvnitř bez bund a čepic; nikdy letní oblečení ve sněhu.
7. **Proporce těla.** Děti dětské, dospělí dospělí; vzájemné výšky podle
   záznamu „Heights:" — batole nikdy nevyroste.
8. **Anatomie.** Přesně dvě ruce, dvě nohy, pět prstů; přirozené tváře;
   kolo má dvě kola.
9. **Klíčové předměty identické.** Stejná loď/auto/hračka (typ i barvy)
   podle záznamu „Key objects:" ve všech scénách.
10. **Žádný text v obraze.** Žádná písmena, číslice, vodoznaky ani podpisy.

## Jak se desatero vynucuje (tři vrstvy)

1. **Kanonický zámek** — popisy vzhledu známých postav se po napsání
   příběhu serverově přepíší doslovnými popisy z `reference/characters.json`;
   vymyšlené postavy musí dostat plný vlastní záznam (`lib/claude.ts`).
2. **Reference + kotva** — kreslení dostává referenční fotky postav
   a obrázek 1. scény jako kotvu stylu (`lib/job-runner.ts`).
3. **Vizuální kontrola (desatero)** — každý obrázek zkontroluje kontrolní
   vision model (`GEMINI_VERIFY_MODEL`, výchozí gemini-2.5-flash) proti
   tomuto seznamu; při porušení 2 opravná překreslení s konkrétním výčtem
   chyb + 1 čerstvé překreslení; drží se NEJLEPŠÍ ověřený pokus — neověřený
   obrázek nikdy nenahradí ověřený (`lib/gemini.ts`).

## Odolnost kontroly (proč platí „všude a pořád")

- Samotná kontrola se při výpadku/přetížení opakuje až 3× s odstupem —
  dřív jediná chyba kontroly znamenala „ok" a vadný obrázek prošel bez
  prohlídky (typicky právě při větší zátěži, kdy vzniká hodně obrázků).
- Verdikt se vynucuje v JSON režimu s dostatečným limitem tokenů — utržená
  odpověď dřív také prošla jako „ok".
- Kartotéka postav se kontrole předává v délce až 8 000 znaků (dřív 4 000 —
  u pohádek s mnoha postavami se konec kartotéky uřízl a poslední postavy
  se nekontrolovaly).
- Verdikt vrací i POČET porušených pravidel — při překreslování se vybírá
  pokus s nejméně chybami, ne slepě ten poslední.
