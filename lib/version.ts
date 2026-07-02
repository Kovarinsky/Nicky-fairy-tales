export const APP_VERSION = "2.46";

// Changelog (newest first)
// 2.46 - Fronta pohádek: až 3 pohádky se připravují najednou na serveru — další jde zadat hned, bez čekání; každá má vlastní řádek s průběhem a tlačítkem Otevřít, kartičky ukazují tu nejnovější
// 2.45 - Až 20 stránek: navazovací serverový job (po 5min limitu Vercelu automaticky pokračuje endpointem /api/job/continue — zdarma, bez Pro plánu); delší příběhy od Clauda (16k tokenů); rychlejší načtení — hotové scény se stahují do telefonu průběžně už během výroby a kartičky ukazují skutečné náhledy
// 2.44 - Fix „nabídka zmizela": rozepsaný draft bez obrázků už neotevře prázdnou temnou čtečku (obnova jen s kompletními obrázky + pojistka: čtečka bez pohádky → návrat na formulář); stažení hotové pohádky ze serveru s retry a placeholderem; otevřený panel ovládání už nepřekrývá toast průběhu
// 2.43 - Serverové generování na Vercelu: pohádka se připraví na serveru (Blob), telefon jen sleduje stav a stáhne výsledek — přepnutí appky nevadí; bez Blob tokenu automatický fallback na lokální generování
// 2.42 - Kotevní obrázek: scéna 1 se generuje první a její obrázek je vizuální referencí pro všechny další scény — postavy, výšky, styl i předměty (auto) se kopírují z ní
// 2.41 - Animace „Píšu příběh": píšící tužka ✍️, blikající tečky, výraznější a rychlejší shimmer
// 2.40 - Key objects lock (auto a předměty stejné v celé pohádce); tlačítko 🔄 Na šířku v panelu (fullscreen + orientation lock)
// 2.39 - Konzistence velikostí: povinné 'Heights:' v popisu postav, lock na věk/proporce, sanitizér zachovává výšky; fallback prompt pro blokované scény; poctivý toast při chybějících obrázcích
// 2.38 - Anti-stuck: Wake Lock (displej nezhasne při generování), hlídač zaseknutí (2,5 min bez pokroku → tlačítko Pokračovat), auto-obnovení při návratu do zamrzlé záložky
// 2.37 - Odolné generování: job se pamatuje (text i obrázky), auto-resume po restartu; průběžné cachování scén; až 3 verifikační kola — pohádka není hotová, dokud nejsou všechny obrázky
// 2.36 - Nové referenční postavy: James (6, nejlepší kamarád z Riverside) a Bella (8, Jamesova sestra) s fotkami
// 2.35 - Rodinné referenční fotky: táta Jan, máma Jana, pes Archie (nová postava), Valentýnka — Gemini nyní dostává fotky a kreslí podle skutečné podoby
// 2.34 - Panel přikotven dole; šipky integrované do obrázku (střed, jeho okraje); Recent stories přesunuty pod pohádku
// 2.33 - Anglické názvy témat (Story world) při EN; vlastní postavy se ukládají (localStorage) — zůstávají do smazání ×, pohádky s nimi zůstávají v historii
// 2.32 - Jednotná velikost obrázků: Gemini generuje 16:9 (imageConfig), zobrazení v pevném 16:9 rámu (cover) v obou orientacích
// 2.31 - Portrait reader: text box přímo pod obrázkem, ovládací panel pod textem (jako v landscape); toggle panelu ťuknutím kamkoli na kartu
// 2.30 - Hudba defaultně vypnutá; titulky ukazují skutečné modely (API /api/models); mluvené „Dobrou noc, Nicolásku a Valentýnko" na konci titulků
// 2.29 - Přepínač jazyka UI 🇨🇿/🇬🇧: celé rozhraní česky nebo anglicky, volba se pamatuje, EN auto-vybere anglického vypravěče
// 2.28 - Text na bílém podkladu: portrait celý text bez rolování, landscape bílý jednořádkový ticker
// 2.27 - Ticker jen pod šířkou obrázku; play z hlavní obrazovky → reader mód; replay z historie auto-přehraje; manifest bez orientation (rotace dle systému)
// 2.26 - Fix hlas (payload bez obrázku + odblokování play); šipky skryté i v portrait (jen s panelem); play zavře panel + restart rollingu; PWA manifest (fullscreen po přidání na plochu)
// 2.25 - Automatická přestavba při otočení: layout + restart rolování textu (portrait ⇄ widescreen)
// 2.24 - Widescreen: bez nadpisu, text = jednořádkový horizontální ticker dole, šipky jen s panelem (odsazené); obraz ~90 % výšky
// 2.23 - Titulky v malém okně POD obrázkem (nepřekrývají obraz), auto-rolling; panel dole (portrait) / vpravo (landscape); fix výšky v landscape
// 2.22 - Imerzní čtečka: obraz přes celý screen, text jako titulky dole (scrolluje, nikdy nepřeteče), ovládání skryté — ťuknutí zobrazí panel vpravo, šipky plovoucí po stranách
// 2.21 - Šířka: full-width obraz na mobilu, tablet/landscape = obraz vedle textu; velká tlačítka přes celý panel; vlajka hlasu (🇨🇿/🇬🇧); play už neukazuje ⏳ při přepnutí hlasu
// 2.20 - Reader: obraz bez ořezu/deformace (contain, kino styl), text scrolluje; pryč Nová pohádka; popisky pod tlačítky; auto-kontrola + oprava chybějících obrázků; 2 scény paralelně; progres i pro bg pohádku
// 2.19 - Reader mode: book vyplní viewport bez edge-to-edge; šipky ← → přesunuty pod kartu (žádné ořezání)
// 2.18 - Detekce přerušeného spojení (přepnutí appky): česká hláška + tlačítko Zkusit znovu; timeout 90s na scene fetch
// 2.17 - Odstraněn reader mode (žádný fullscreen); pohádka se zobrazí pod formulářem s auto-scroll; popis kroků generování
// 2.16 - Odstraněno expand-on-play (CSS position:fixed overlay při ▶); čistý reader mód bez přepínání
// 2.15 - Expand on play: ▶ roztáhne book přes celý viewport (CSS position:fixed, bez native fullscreen)
// 2.14 - Reader: max screen (edge-to-edge, skrytý back-btn, kompaktní titulek); konzistence postav: APPEARANCE LOCK v Gemini i Claude
// 2.13 - Tlačítko Vytvořit pohádku: animovaný progress fill + %; gen-cards pod tlačítkem; odstraněno Zpět na pohádku
// 2.12 - Odstraněn fullscreen mód; oranžové šipky ← → pro navigaci scén
// 2.11 - Gen-cards od začátku načítání; oranžové tlačítko 🏠 v ovládání; oranžové tlačítko Zpět na pohádku
// 2.10 - Fullscreen: image 16:9 (no crop), text pod ním; fix text overflow; témata: Pokémon + Sonic
// 2.9 - Reader mode: viewport-filling layout (CSS Grid 1fr na book-card), image vyplní zbývající výšku
// 2.8 - Fullscreen: tap-to-show ovládání (controls skryty, zobrazí se na klik/tap na 3s, pak zmizí)
// 2.7 - Fullscreen: CSS Grid (1fr auto auto auto) na book-card → controls vždy viditelné; 16:9 aspect-ratio v reader; audio optional
// 2.6 - Historie: výrazné karty s offline/size/scény badge, tlačítko → oranžový % bar + ikonky scén
// 2.5 - Fullscreen: obraz dostane explicitní height:65dvh (bez flex chain), draft pohádky do localStorage při přepnutí okna
// 2.4 - Fullscreen: .book dostane position:fixed inset:0 z-index:10 — bypasses flex chain, viewport height garantována
// 2.3 - Fullscreen: wrapper-div + position:absolute inset:0 pro obraz (grid 1fr nefungoval s flex-allocated height v Chrome Android)
// 2.2 - Konzistence postav: silnější Gemini prompt (zákaz extra postav, fixní vlasy+oblečení), Claude kopíruje popis doslova
// 2.1 - Fullscreen: okamžité nastavení CSS třídy (iOS + Android fix); Cache: vždy ukládat i při chybě audia; bookReady = obrazky stačí
// 2.0 - Verze badge, fix historie během bg generování, IndexedDB cache cross-session
// 1.9 - IndexedDB cache pro pohádky z historie (přežije restart PWA)
// 1.8 - Fullscreen opravy: správný flex chain, ctrl-fullscreen rozměry, aspect-ratio fix
// 1.7 - Fullscreen mód (⛶), swipe slidy, tečky uvnitř karty
// 1.6 - Paralelní generování + sledování starší pohádky, cache scén v paměti
// 1.5 - Reader mód (celá obrazovka pro pohádku), auto-fullscreen při spuštění
// 1.4 - Oprava 504 timeoutu pro 15 scén, hudební tlačítko v formuláři
// 1.3 - Rolling credits po dokončení pohádky
// 1.2 - ElevenLabs hlas, výběr vypravěče
// 1.1 - Gemini ilustrace, background music
// 1.0 - Základní verze: Claude + generování pohádek
