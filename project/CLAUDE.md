# Nickyho pohádky — kánon postav

Vždy dodržuj při generování ilustrací a ikon:

- **Nicolásek (Nicky)** — kluk, 6 let, **111 cm**, blond vlasy, béžová kšiltovka, **hnědé oči**.
- **Valentýnka** — holčička, necelé 2 roky (batole), sahá Nicoláskovi **po bradu** (~85 cm), blond vlásky **po ramena** (často culík/spončky nebo růžová mašle), **hnědé oči**, batolecí proporce (větší hlava, kratší nožky).
- **Archie** — rodinný pes, 9 let, staffordshire bullteriér; podsaditý, svalnatý; červenohnědá (red/tan) krátká srst, bílá náprsenka, bílé tlapky/ponožky, **malé bílé srdíčko na čele mezi očima** (NE pruh přes celý čenich), **hladká jednolitá červenohnědá tvář BEZ tmavé masky kolem očí a BEZ tmavých fleků na obličeji**, jen uši jsou o něco tmavší; bílá tlama/brada, tmavý čumák, hnědé oči, černý kožený obojek s mosaznou přezkou, klidný dobrácký výraz. Refs: `assets/refs/archie-foto.jpg` (skutečná fotka) + `assets/postavy/archie.png` = `archie-kanon.jpg` (schválená kanonická ilustrace).

Fotoreference (assets/refs/): `jan-portret-referencni.jpg` (čistý fotorealistický portrét táty Jana — samostatný, bez skupiny, pro věrnost rysů: tmavé vlasy jen mírně ustupující ve spáncích, prošedivělé strniště, hnědé oči, opálený), `nicolasek-portret-lod.jpg` a `nicolasek-portret-stul.jpg` (obličej zblízka — rovné blond vlasy s ofinou, hnědé oči, kulatá tvář), `nicolasek-a-valentynka-vyska.jpg` (poměr výšek Nicolásek × Valentýnka — batole s culíkem/sponkami, růžové šaty), `nicolasek-s-jamesem-vyska.jpg` (Nicolásek vpravo, kamarád James vlevo), `nicolasek-s-tatou.jpg`, `valentynka-portret-tata.jpg` a `valentynka-portret-mavani.jpg` (Valentýnka zblízka — hnědé oči, jemné blond vlásky s culíkem, buclaté batolecí tváře), `rodina-tata-jan-mama-jana.jpg` (celá rodina: táta Jan, máma Jana — dlouhé blond vlasy, Nicolásek, Valentýnka). Používej je jako vstup pro generování postav.

Rodiče (pro případné rodinné scény): **táta Jan** — **185 cm**, krátké tmavě hnědé vlasy s výrazněji ustupující linií na spáncích a řídnoucí vpředu/na temeni (skutečný receding hairline dle fotoreferencí, ne hustá kštice), prošedivělé strniště, hnědé oči, opálený, hranatější čelist, široký vřelý úsměv s výraznými zuby (viz `assets/postavy/jan.png`); **máma Jana** — **175 cm**, dlouhé rovné blond vlasy, štíhlá, modré/světlé oči.

Kamarádi (druhá rodina, refs v assets/refs/): **James** — kluk ~6-7 let, **115 cm** (o chlup vyšší než Nicolásek), krátké tmavě hnědé vlasy, modrošedé oči (`james-portret.jpg`, `nicolasek-s-jamesem-vyska.jpg` — je o trochu vyšší než Nicolásek); **Bella** — holka ~10 let, vyšší než James (James jí je po uši, tj. Bella ~135 cm), dlouhé hnědé vlasy (`bella-portret.jpg`); jejich **máma Eva** — **180 cm**, blond vlasy po ramena, často stažené do culíku, výrazné obočí, šedomodré oči (`eva-portret.jpg`); **táta Jakob** — **183 cm**, rozcuchané hnědé vlasy, modré oči, strniště (`jakob-portret.jpg`, `jakob-portret-vecer.jpg`). Společné foto obou rodin: `spolecna-obe-rodiny.jpg`.

Styl ilustrací: navazuj na stávající ilustrace příběhů v assets/refs/ `styl-auticko-1/2/3.jpg`, `styl-zima-rodice.jpg`, `styl-les-pokemon.jpg` — lesklý teplý storybook cartoon (velké oči, měkké stínování, syté barvy), NE flat vector, NE 3D render. Postavy vždy věrné fotopredlohám.
Schválený vzhled postav (kanonická podoba): `assets/postavy-lineup-v3.jpg` = `assets/postavy-lineup-vysky.jpg` (celopostavová sestava s výškovým metrem po 20 cm v pozadí — kanonický podklad pro **velikosti a proporce** postav vůči sobě; použij ho jako referenci vždy, když je ve scéně víc postav) + výřezy jednotlivých postav v `assets/postavy/*.png` (nicolasek, valentynka, jan, jana, james, bella, eva, jakob, archie). Při generování nové scény VŽDY přilož jako referenci výřez postavy z `assets/postavy/` (podoba, účes, oči) — fotky v assets/refs/ jsou druhotná opora. Oblečení je ale VOLNÉ podle situace: v promptu vždy popiš oblečení odpovídající scéně (pyžamo, zimní bunda, plavky…), stálé zůstávají jen rysy tváře, účes, barva očí a proporce. Jediná výjimka: Nicolásek nosí béžovou kšiltovku, pokud scéna neurčí jinak (noc/spánek = bez kšiltovky).

Brand: oranžový gradient #f59e0b → #f97316; písma Alegreya (nadpisy) + Nunito (UI).

## JEDINÝ ilustrační styl (platí pro KAŽDÝ generovaný obrázek)

Scény pohádek, pozadí obrazovek, ikony tlačítek, karty světů — vše. Jeden styl, různé kompozice; nikdy jiný přístup pro jinou obrazovku.

- **Technika:** teplá malovaná dětská ilustrace (moderní ilustrovaná knížka, Pixar-adjacent concept art). NE plochý vektor/sticker, NE 3D render s leskem, NE fotorealismus, NE crayon/pastelkový vzhled s vlnitou linkou.
- **Linka:** měkké okraje, tvary dané barvou a stínováním, ne tlustá černá kontura ani ostré vektorové obrysy.
- **Světlo a barvy:** teplé zlatavo-oranžové světlo (svíčky, světlušky, kouzelné záře) proti hlubokým indigovo-fialovým nočním tónům; pro denní scény jemné syté teplé pastely. Jemný glow kolem světelných prvků.
- **Postavy:** velké výrazné oči, měkké zaoblené dětské proporce, růžové tváře, přátelské jednoduché výrazy — stejný look jako referenční postavy appky, ne obecný cartoon.
- **Hloubka:** jemná atmosférická perspektiva, vzdálenější prvky mírně rozostřené.
- **Závazné referenční obrázky stylu:** `uploads/bgintrov6 (1).png` + `uploads/{postavy,svety,hlas,pozadi}_ring_final (1).png` — každý nový obrázek musí vypadat, jako by ho namaloval stejný ilustrátor stejného dne.
- **Světlost a tón:** každá ikonka/karta musí být **světlá, přívětivá a dětská** — teplé prosvětlené barvy, usměvavé postavy, nic temného, hrozivého ani „epického" (žádné rudé záře, temné siluety, dramatické akční kompozice). Platí i pro dospělácké motivy (sci-fi, firmy) — vždy převyprávěné jako dětská pohádka.
- **Zakázané (už neúspěšně zkoušené) přístupy:** lesklé 3D ikony se specular highlightem (kulečníková koule), plochý sticker/vektor s bílým obrysem, ručně kreslený crayon/omalovánkový styl.
