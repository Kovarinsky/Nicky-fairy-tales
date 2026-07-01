export const APP_VERSION = "2.7";

// Changelog (newest first)
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
