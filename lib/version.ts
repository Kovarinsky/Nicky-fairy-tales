export const APP_VERSION = "2.70";

// Changelog (newest first)
// 2.70 - Počet stránek se místo posuvníku (šlo o něj omylem zavadit) nastavuje tlačítky − a + po stranách čísla; drží meze 3–20
// 2.69 - Tlačítko 🧹 Smazat text u pole přání (objeví se, jen když v poli něco je); živější přednes hlasu (voice_settings: víc intonace a dramatičnosti); zvířecí zvuky se píší foneticky a protaženě („Haf haf!“, „Mňauuu…“), ať je vypravěč zahraje; česká výslovnost jmen — do TTS jde Nikolásek/Džejms/Árčí (titulky zůstávají s původním pravopisem)
// 2.68 - Pozadí aplikace jsou teď ilustrace ve stylu pohádek: maluje je Gemini (stejný styl jako obrázky scén), každý z 9 světů se vygeneruje jen jednou a uloží na server (backgrounds/); než se stáhne, drží barevný gradient z v2.67
// 2.67 - Přepínatelné pozadí aplikace: 9 světů (noc, les, hory, vesmír, džungle, moře, závody, pouť, kouzlo) malovaných v CSS; tlačítko 🎨 vlevo nahoře jimi roluje, režim Auto přepne pozadí samo podle zvoleného tématu pohádky (vlastní svět = ✨ kouzlo); volba se pamatuje
// 2.66 - Anglické názvy postav v EN verzi (Dad Jan, Mom Jana, Archie the dog…) v chipech i vyprávění; tlačítko 🎲 Vymysli námět (Claude navrhne zápletku do pole přání); vlastní svět pohádky podle fotky nebo popisu — chip „+ Vlastní svět", uložené světy se dají znovu použít i smazat
// 2.65 - Titulky na šířku: text jede synchronně s hlasem (řízeno pozicí v nahrávce, pauza text zastaví), vnitřní okraje rámečku + měkké vyjíždění textu na krajích; rámeček zůstává na šířku obrázku
// 2.64 - Oprava: dlouhý název pohádky vytlačoval tlačítka 🗑️ a ▶ mimo displej (grid minmax(0,1fr) + zkrácení názvu trojtečkou)
// 2.63 - Mazání pohádek z historie: ikona 🗑️ u každé položky (s potvrzením) — smaže pohádku z telefonu vč. offline dat a uvolní místo
// 2.62 - Věrnější táta Jan: nová detailní fotka obličeje jako druhá reference pro Gemini + přesnější popis (vysoké čelo, krátké tmavě hnědé vlasy, strniště, hnědé oči); podpora více referenčních fotek na postavu
// 2.61 - Oprava „blob-write-failed: invalid header value": Blob token se čistí (uvozovky, nové řádky, smetí z Quickstartu) — z hodnoty se vytáhne jen samotný vercel_blob_rw_… token
// 2.60 - Server už nehromadí hotové pohádky (jsou v telefonu): po stažení se serverová data pohádky mažou okamžitě, úklid chrání jen běžící joby (+1h lhůta), běží 1× za hodinu — bezplatný 1GB Blob se už nezaplní; důvod selhání startu se zobrazí (Server: blob-write-failed…)
// 2.59 - Diagnóza mrtvých startů: start jobu zapíše stav SYNCHRONNĚ — když Blob zápis selže (plné úložiště / token), vrátí se viditelná chyba místo zombie jobu; úklid úložiště běží i při startu aplikace (1× za 6 h) a maže osiřelé joby starší 3 h
// 2.58 - Záchrana zaseknutých pohádek: job, který na serveru nikdy nezapsal stav (404), se automaticky oživí přes /continue nebo po 5 min ukončí chybou; zaseknutý díl tlačítka červeně pulzuje s ⚠️ — ťuknutím nakopnete, podruhé odeberete z fronty
// 2.57 - Offline zásoba rozšířena na 20 pohádek (localStorage/IndexedDB/Blob drží posledních 20; žádost o trvalé úložiště, ať prohlížeč cache nemaže); upozornění před generováním na mobilních datech (~30 MB, potvrzení 1× za sezení)
// 2.56 - Ťuknutí na díl tlačítka (1./2./3.) přepne kartičky na průběh té konkrétní pohádky; zvolený díl je zvýrazněný bílým rámečkem
// 2.55 - Fronta bez bublinek: velké tlačítko se rozdělí na části — jedna část na pohádku (✍️ píše se / 🎨 x/y s plnícím se pruhem / ▶ Otevřít / ⚠️ chyba); plovoucí bublinky z hlavní obrazovky zmizely
// 2.54 - Oprava zaseknutého „Píšu novou pohádku": kratší imagePrompty (popis postav se do obrázků vkládá automaticky, nekopíruje se 20×) → psaní 20stránkové pohádky se vejde do 5min limitu; retry při zahlcení Claude API (429); popisek, že kartičky ukazují nejnovější pohádku
// 2.53 - Při čtení pohádky se neukazují bublinky průběhu dalších pohádek — průběh a tlačítko Otevřít uvidíte po návratu Domů
// 2.52 - Čtečka na PC a tabletu přes CELOU obrazovku (zrušen limit šířky 860 px v reader módu; formulář zůstává úzký)
// 2.51 - Oprava Spotřeby: částky z Anthropic API jsou v centech (ukazovalo 100× víc), přepočet na Kč kurzem ČNB; srozumitelná hláška, když ElevenLabs klíč nemá oprávnění číst účet
// 2.50 - Chybová hláška jde zavřít křížkem ✕ (dřív zůstávala až do dalšího pokusu)
// 2.49 - Přehled 💰 Spotřeba: skutečná útrata za Claude (Admin API, celý účet, posledních 30 dní) a stav kreditů ElevenLabs přímo v aplikaci; Gemini jen odkazem (Google útratu přes API nevydává)
// 2.48 - Spolehlivější start serverové výroby (fronty): 2 pokusy s timeoutem 30 s místo jednoho s 15 s, server odpovídá okamžitě (zápis zadání do Blobu až po odpovědi) — méně pádů do lokálního generování bez fronty
// 2.47 - Automatický úklid Blob úložiště: po dokončení pohádky se smažou serverová data jobů, které vypadly z historie posledních 10 pohádek (běžící a čerstvé joby <24 h se nikdy nemažou)
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
