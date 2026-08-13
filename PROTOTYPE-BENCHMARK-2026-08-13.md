# One-sheet prototyp — benchmark 2026-08-13

## Verdikt

Feature-flagovaný prototyp vytvořil 10 hotových slidů za 152 sekund od zadání. Obrazová část spotřebovala jeden 4K arch a dva 1K obrázky: samostatný hero a jeden QA fallback. Časový cíl 5 minut je splněný s rezervou. Obrazový náklad je těsně nad cílem; celý end-to-end náklad včetně psaní a audia tímto benchmarkem zatím prokázaný není.

Preview: https://nicky-fairy-tales-jan-8098-jk-advisory.vercel.app

Produkční `main` ani produkční deployment nebyly změněny. Pipeline je aktivní pouze s `ONE_SHEET_STORY=true`.

## Naměřený běh

- Job: `637b33ee-2801-4f93-9c32-c03d894f0e9c`
- Vercel deployment: `dpl_ERjZ4r9ca23bbihyuHXEkt4wHKfN`
- Zadání: česká pohádka, 10 scén, Nicolas + Valentýna
- Scénář: 45 s, 8 172 znaků
- Celkem: 152 s
- Hotovo: 10/10 slidů, bez restartu nebo self-chainu
- Arch: 9 panelů, 8/9 prošlo vision QA
- Fallback: scéna 9 byla překreslena samostatně kvůli chybné barvě očí
- Spotřeba: 1× 4K + 2× 1K
- Obrazový API náklad: `1 × $0.151 + 2 × $0.067 = $0.285`
- Přepočet: 5,99 Kč při auditním kurzu 21 Kč/USD; 6,56 Kč při konzervativním interním kurzu appky 23 Kč/USD
- Claude tokeny: 1 266 input, 3 320 output, 16 337 cache-write; přibližně $0.0766 neboli 1,76 Kč při interním kurzu
- Naměřený obraz + scénář: přibližně 8,32 Kč při interním kurzu; audio nebylo součástí serverového benchmarku

Ideální běh bez QA fallbacku by spotřeboval 1× 4K + 1× 1K, tedy $0.218 (5,01 Kč při interním kurzu). Samotný jediný 4K arch bez samostatného hero obrázku by stál $0.151, ale je to další kompromis v kvalitě a latenci, který tento prototyp nezapíná.

## Vizuální kontrola

Všechny slidy jsou použitelné, mají vysoké rozlišení (řezy archu přibližně 1600×896 px, samostatné obrazy přibližně 1376×768 px), konzistentní ilustrační styl, prostředí, oblečení a věkový rozdíl postav. Pevné rozřezání archu nezanechalo viditelné mřížky ani useknuté sousední panely.

Zbývající canon nedostatky:

- vision QA zachytilo jednu chybu barvy očí, ale modré oči Valentýnky přehlédlo i v několika dalších panelech;
- v úvodních panelech působí hvězdička někdy jako shluk světel a ne jako jednoznačná pěticípá postava;
- jeden arch přirozeně drží styl a prostředí lépe, ale jemné atributy postav se bez přísnějšího QA mohou opakovaně odchýlit.

Proto prototyp doporučuji jako základ A/B testu, ne k okamžitému zapnutí pro všechny uživatele. Další krok je atributové QA zaměřené na 3–5 nejdůležitějších canon znaků každé postavy a limitované opravy tak, aby průměr zůstal pod jedním fallbackem na pohádku.

## Co bylo opraveno

- Gemini 4K sazba je opravena na $0.151.
- Po self-chainu se účtuje kumulativní počet všech 1K/4K generování, ne pouze poslední invokace.
- TTS znaky se nezapisují podruhé do story usage záznamu.
- Konkurenční zápisy job statusu jsou serializované, takže starší Blob PUT nepřepíše novější stav.
- Self-chain zůstává na stejném Preview deploymentu; nepřeskočí omylem na produkci.
- Benchmark bypass je pouze pro non-production deployment s feature flagem a neveřejným tokenem; bez tokenu je vypnutý.
- Pricing regresní testy, TypeScript kontrola a produkční build procházejí.

## Co ještě není hotové

- Provider/model-level ledger pro skutečný TTS náklad a serverové měření kompletního audio času.
- Přísnější canon QA bez nekontrolovaného růstu placených fallbacků.
- Statisticky významný vzorek; tento běh prokazuje technickou dosažitelnost, ne p95 náklad a kvalitu.
- Produkční rollout, migrace účtování a A/B telemetrie. Ty musí následovat až po více kontrolovaných bězích a vizuálním schválení.

## Doporučený rollout

1. Nechat `ONE_SHEET_STORY` pouze na Preview a ručně zkontrolovat alespoň 10 různých pohádek.
2. Měřit p50/p95 čas, 4K/1K spend, QA pass rate, počet fallbacků a ruční hodnocení identity postav.
3. Zpřísnit QA pro explicitní canon atributy; držet hard cap jednoho placeného fallbacku.
4. Doplnit provider-aware TTS ledger a teprve potom tvrdit celkový Kč náklad za pohádku.
5. Po schválení pustit malý produkční canary segment a zachovat okamžitý návrat na současnou pipeline feature flagem.
