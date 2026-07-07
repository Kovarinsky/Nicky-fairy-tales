# Pravidla konzistence pohádek

Závazná pravidla, která musí dodržet KAŽDÁ vygenerovaná pohádka.
U každého pravidla je uvedeno, kde v kódu se vynucuje.

## 1. Vzhled postav je kanonický
Vzhled známých postav (vlasy, oči, obličej, výchozí oblečení, stavba těla)
je definován JEDINĚ v `reference/characters.json`. Claude ho nesmí měnit —
po vygenerování příběhu se popis vzhledu **serverově přepíše doslovnými
kanonickými popisy** (`enforceCanonicalAppearance` v `lib/claude.ts`).
→ Nicolas má VŽDY „straight light-blond hair", v každé scéně, v každé pohádce.

## 2. Zámek vzhledu jde do každého obrázku
Kanonický popis (APPEARANCE LOCK) se automaticky vkládá na začátek i konec
promptu KAŽDÉ scény (`lib/gemini.ts`), spolu s referenčními fotkami postav
a kotevním obrázkem (scéna 1) pro jednotný styl celé knížky.

## 3. Opakující se předměty jsou zamčené (Key objects)
Auto, kouzelný předmět, hračka — a VŽDY sportovní vybavení (kolo, lyže…) —
se zamykají v záznamu `Key objects:` s přesným typem a barvami.
Časovkářské kolo se nikdy nezmění v silniční. (`lib/claude.ts` prompt
+ přenos do každého obrázku přes appearance lock.)

## 4. Převleky jen přes „Story outfits"
Když děj vyžaduje jiné oblečení než kanonické (sport, zima, kostým),
kanonický záznam postavy se NEMĚNÍ — přidá se `Story outfits:` se
zamčeným převlekem platným pro CELÝ příběh (jeden převlek na postavu).

## 5. Výšky postav jsou relativní a neměnné
`Heights:` popisuje relativní výšky bez věkových slov (Valentýnka po pás
Nicolasovi, dospělí výrazně vyšší) — batole zůstává batoletem na všech
obrázcích.

## 6. Anatomie a styl natvrdo
Každý obrázek má ve stylu vynuceno: 2D malovaná storybook ilustrace
(zákaz 3D renderu, CGI, fotorealismu), správná anatomie (přesně dvě ruce,
dvě nohy, pět prstů; kolo má dvě kola), žádný text, vodoznaky ani podpisy.
(`STYLE_SUFFIX` v `lib/gemini.ts`.)

## 7. Jen postavy ze scény
Na obrázku smí být pouze postavy jmenované ve scéně — žádní cizí lidé
ani figury v pozadí.

## 8. Konzistence příběhu
Postavy vystupují vždy pod svým jménem, povaha se nemění, příběh má
oblouk (háček → napětí → zasloužené rozuzlení) a scény na sebe odkazují.

## 9. Krátké imagePrompty
Max 60 slov, postavy jen JMÉNEM — popisy se doplňují automaticky ze
zámku. (Chrání konzistenci i rychlost psaní.)

## 10. Technické pojistky provozu
Denní kvóta Gemini zastaví pohádku hned (žádné pálení kreditu),
zaseknutý job se oživí max 4× a pak skončí viditelnou chybou,
job bez jediného obrázku nikdy neskončí jako „hotový".

---
*Známé limity: generativní model může vzácně chybovat (prst navíc,
odlišný odstín pozadí) i při dodržení všech zámků — pravidla chybovost
řádově snižují, ale nulová není. Pro komerční nasazení by poslední
pojistkou byla automatická kontrola vygenerovaných obrázků (vision
model porovná scénu se zámkem a nechá vadné překreslit).*
