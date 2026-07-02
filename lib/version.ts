export const APP_VERSION = "2.29";

// Changelog (newest first)
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
