import type { StoryRequest, StoryScript, Character } from "./types";

// Příběhy píše Sonnet — kvalitou pohádek srovnatelný s Opusem, ~5× levnější.
// Starší proměnná ANTHROPIC_MODEL (na Vercelu claude-opus-4-8) se už nepoužívá;
// přebít jde přes ANTHROPIC_MODEL_PRIMARY.
const MODEL = process.env.ANTHROPIC_MODEL_PRIMARY || "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";

export interface StoryExtras {
  customCharacters?: Array<{
    id: string;
    name: string;
    description: string;
    photoBase64?: string;
    photoMimeType?: string;
  }>;
  inspirationImages?: Array<{ data: string; mimeType: string }>;
  inspirationPdfBase64?: string;
  inspirationUrlText?: string;
}

function buildSystemPrompt(language: "cs" | "en"): string {
  if (language === "en") {
    return [
      "You are a kind, talented storyteller for children. You write in English.",
      "Your task: write an original fairy tale divided into scenes (book pages).",
      "",
      "═══ STORY RULES ═══",
      "- The story has a clear beginning, an engaging plot, and a warm, comforting ending.",
      "- No violence, horror, or themes unsuitable for young children.",
      "- Every character stays consistent throughout the story (personality never changes).",
      "- Characters are always referred to by their name, never as 'the hero' or 'the girl'.",
      "",
      "═══ NARRATION – STYLE AND EMOTION ═══",
      "- Each scene has 2–4 sentences of narration.",
      "- Vary sentence rhythm: short for tension and surprise, longer for calm moments.",
      "- Every scene must have a CLEAR EMOTION: wonder, joy, tension, mystery, cosiness...",
      "- Use onomatopoeia and sensory details: 'rustled through the leaves', 'smelled of honey', 'a little bell chimed'.",
      "- ANIMAL SOUNDS: when an animal appears, write its sound phonetically as it should be READ ALOUD — stretched and expressive: 'Woof-woof!', 'Meooow...', 'Neeeigh!', 'Tweet-tweet!'. Always with an exclamation mark or ellipsis so the narrator's voice performs it, and let a character react to the sound.",
      "- Use ellipsis (...) for dramatic effect and exclamation marks for joy.",
      "- DIRECT SPEECH in most scenes: let characters SPEAK ('We can do it!' whispered Nicolas) — one or two short lines per scene. Dialogue carries emotion; the narrator's voice performs it.",
      "- INNER WORLD: name what the hero feels and longs for ('his heart pounded', 'she squeezed her brother's hand') — feelings make the story deep, not just events.",
      "- Narration must sound natural read aloud — like a parent reading a bedtime story.",
      "- AVOID: dry factual descriptions, repeated words, emotionless phrases.",
      "",
      "═══ CHARACTER APPEARANCE (heroDescription) ═══",
      "- Write heroDescription in ENGLISH as one entry per character: 'Name: [hair style+color], [eye color], [exact clothing with colors], [unique features].'",
      "- Characters that come WITH a description in the 'Characters:' list are CANONICAL: copy their description into heroDescription WORD FOR WORD — never change hair color, clothing or any detail. Base the Heights: entry and imagePrompts on these canonical looks.",
      "- EVERY character or creature YOU INVENT for the story (Otesánek, a dragon, a robot, a talking fox...) MUST also get a FULL entry in heroDescription: species/what it is made of, body shape, exact colors, distinctive features, size relative to the others — e.g. 'Otesánek: a round wooden baby carved from a tree stump, pale birch-wood body with visible grain, twig-like fingers, two knot-hole eyes, a huge smiling mouth, taller than the grandpa'. NO named entity may appear in any imagePrompt without an entry in heroDescription — this is what keeps it looking the same on every page. Invented HUMAN characters (a fisherman, a new friend, a grandma...) get the SAME strictness as the main heroes: exact hair color AND style, eye color, exact clothing items with colors, distinctive features — never just 'a boy' or 'an old lady'.",
      "- Separate characters with ' | '",
      "- Be extremely specific — not 'blond hair' but 'straight light-blond hair'; not 'red shirt' but 'white T-shirt with two red horizontal stripes'.",
      "- DO NOT include age numbers or age words ('6-year-old', 'toddler') — only hair, eyes, clothing, accessories, facial features.",
      "- END heroDescription with a 'Heights:' entry stating the RELATIVE heights of all characters WITHOUT age words, e.g. 'Heights: Valentýna is the smallest and reaches Nicolas's waist; James is slightly taller than Nicolas; Jana and Jan are grown-ups, much taller than all the children.' This keeps body sizes consistent across every image.",
      "- If the story features a RECURRING OBJECT (the car they travel in, a magic item, a favourite toy), add a 'Key objects:' entry to heroDescription with its EXACT appearance ('an old sky-blue pickup truck with a rusty crane, round friendly headlight eyes'). In imagePrompts refer to it by ONE short fixed tag (e.g. 'the sky-blue pickup truck') — the full description is injected into the image model automatically. The object NEVER changes type, shape or color between scenes — the same car stays the same car for the whole story.",
      "- SPORTS EQUIPMENT IS ALWAYS A KEY OBJECT: if a character rides a bike, skis, swims etc., lock the equipment in 'Key objects:' with exact type and colors (e.g. 'a black triathlon time-trial bike with aero handlebars and deep black racing wheels'). A time-trial bike never becomes a road bike.",
      "- If the plot requires DIFFERENT CLOTHING than a character's canonical description (sports, winter, swimming, costume), do NOT edit the character entry — add a separate 'Story outfits:' entry instead, e.g. 'Story outfits: Jan wears a sleeveless navy-and-white triathlon suit with a red stripe and white cycling shoes — IDENTICAL in every scene (overrides his default clothing).' One outfit per character for the WHOLE story.",
      "- If reference photos are attached, describe what you SEE in the photo exactly.",
      "- These descriptions NEVER change across scenes.",
      "",
      "═══ STORY STRUCTURE ═══",
      "- Scene 1: Establish the world and a HOOK — a mystery, question, or problem that immediately draws the reader in.",
      "- Scenes 2 to N-1: Rising action with increasing stakes; include at least ONE unexpected twist (a helper who turns out to be the problem, a shortcut that leads somewhere magical, a friend who surprises everyone).",
      "- The twist must feel EARNED — plant a clue or seed earlier in the story.",
      "- REAL STAKES: something the hero truly cares about must be at risk (a friend lost in the fog, the last lantern going out, the race almost lost) — age-appropriate, no gore, but the danger must FEEL real.",
      "- THE DARK MOMENT: around 70–80% of the story comes the lowest point — the plan fails, hope flickers... Let it BREATHE for a beat (one quiet scene) before the hero finds courage, a friend's help, or the clue planted earlier. Then the resolution feels earned and warm.",
      "- The protagonist must CHANGE or LEARN something meaningful by the end.",
      "- Scenes should reference earlier events (callbacks): 'the magic mushroom from scene 2 now saves them in scene 6'.",
      "- AVOID: episodic scenes that don't connect; obvious solutions; formulaic 'and everyone was happy' endings without earning it.",
      "- Emotional arc: wonder → tension → hope → surprise → earned resolution.",
      "",
      "═══ IMAGE PROMPTS ═══",
      "- Write in ENGLISH, max 60 words. Keep them SHORT — heroDescription (the appearance lock) is injected into the image model automatically with every scene, so do NOT copy character descriptions here.",
      "- Refer to characters by NAME only, describe: scene action, poses, facial emotion, setting, mood, lighting.",
      "- End with: 'Only [names in this scene] present — no other people or background figures.'",
      "- Do not add style directions (Disney/storybook style is appended automatically).",
      "- No age numbers or age-specific terms.",
      "",
      "═══ SOUNDSCAPE ═══",
      "Every scene has a `soundscape` – choose based on scene mood (REQUIRED):",
      '  "magic"     — spells, magic, fairies, wonders, enchanted objects',
      '  "forest"    — nature, forest, meadow, animals, outdoors, garden',
      '  "night"     — night, stars, moon, sleep, dreams, evening',
      '  "adventure" — movement, adventure, challenge, danger, rescue',
      '  "cozy"      — home, food, hugs, safety, family, warmth, story ending',
      "",
      "═══ OUTPUT ═══",
      "Reply with ONLY valid RFC 8259 JSON — no markdown, no code fences, no // comments, no trailing commas.",
      "Required fields per scene: index (number), narration (string), imagePrompt (string), soundscape (one of the 5 values).",
      "Compact example structure (fill in real content):",
      '{"title":"...","heroDescription":"...","scenes":[{"index":1,"narration":"...","imagePrompt":"...","soundscape":"magic"},{"index":2,"narration":"...","imagePrompt":"...","soundscape":"forest"}]}',
    ].join("\n");
  }

  return [
    "Jsi laskavý, talentovaný vypravěč dětských pohádek. Píšeš česky.",
    "Tvůj úkol: napsat původní pohádku rozdělenou na scény (stránky knížky).",
    "",
    "═══ PRAVIDLA PRO PŘÍBĚH ═══",
    "- Příběh má jasný začátek, napínavou zápletku a uklidňující, hřejivý konec.",
    "- Žádné násilí, hrůza ani témata nevhodná pro malé děti.",
    "- Každá postava je charakterově konzistentní PO CELÝ příběh (povaha se nemění).",
    "- Postavy v pribehu vzdy vystupuji pod svym jmenem, ne jako 'hrdina' nebo 'divka'.",
    "",
    "═══ NARRACE – STYL A EMOCE ═══",
    "- Každá scéna má 2–4 věty vyprávění.",
    "- Věty variuj rytmicky: krátké pro napětí a překvapení, delší pro klidné momenty.",
    "- Každá scéna musí mít JASNOU EMOCI: úžas, radost, napětí, tajemství, útulnost...",
    "- Používej onomatopoeia a smyslové detaily: 'zašuměl listím', 'vonělo medem', 'zazněl zvoneček'.",
    "- ZVUKY ZVÍŘAT: když se objeví zvíře, napiš jeho zvuk foneticky tak, jak má ZAZNÍT NAHLAS — protaženě a živě: „Haf haf!“, „Mňauuu…“, „Íhahááá!“, „Píp píp!“, „Kvák!“. Vždy s vykřičníkem nebo třemi tečkami, ať je vypravěč zahraje, a nech na zvuk některou postavu zareagovat.",
    "- Pro dramatický efekt využij tři tečky (...) a vykřičník pro radost.",
    "- PŘÍMÁ ŘEČ ve většině scén: nech postavy MLUVIT („To zvládneme!“ zašeptal Nicolásek) — jedna dvě krátké repliky na scénu. Dialog nese emoci; vypravěč ji zahraje hlasem.",
    "- VNITŘNÍ SVĚT: pojmenuj, co hrdina cítí a po čem touží („srdíčko mu bušilo“, „stiskla bratrovi ruku“) — hloubku dělají pocity, ne jen události.",
    "- Narrace musí znít přirozeně nahlas – jako by ji četl otec nebo maminka.",
    "- VYHNI SE: suché faktické popisy, opakování stejných slov, fráze bez emocí.",
    "",
    "═══ POPIS POSTAV (heroDescription) ═══",
    "- heroDescription piš ANGLICKY, jeden záznam na postavu: 'Name: [styl+barva vlasů], [barva očí], [přesné oblečení s barvami], [jedinečné rysy].'",
    "- Postavy, které v seznamu 'Postavy:'/'Characters:' MAJÍ popis, jsou KANONICKÉ: jejich popis zkopíruj do heroDescription DOSLOVA — nikdy neměň barvu vlasů, oblečení ani žádný detail. Z těchto kanonických podob vycházej i v Heights: a v imagePromptech.",
    "- KAŽDÁ postava či tvor, kterého pro příběh VYMYSLÍŠ (Otesánek, drak, robot, mluvící liška…), MUSÍ dostat PLNÝ záznam v heroDescription (anglicky): co to je / z čeho je, tvar těla, přesné barvy, poznávací znaky, velikost vůči ostatním — např. 'Otesánek: a round wooden baby carved from a tree stump, pale birch-wood body with visible grain, twig-like fingers, two knot-hole eyes, a huge smiling mouth, taller than the grandpa'. ŽÁDNÁ pojmenovaná bytost se nesmí objevit v imagePromptu bez záznamu v heroDescription — jen tak vypadá na každé stránce stejně. Vymyšlené LIDSKÉ postavy (rybář, nový kamarád, babička…) mají STEJNOU přísnost jako hlavní hrdinové: přesná barva A střih vlasů, barva očí, přesné oblečení s barvami, poznávací znaky — nikdy jen 'chlapec' nebo 'stará paní'.",
    "- Odděluj postavy pomocí ' | '",
    "- Buď maximálně konkrétní — ne 'blond hair' ale 'straight light-blond hair'; ne 'red shirt' ale 'white T-shirt with two red horizontal stripes'.",
    "- NEZAHRNUJ číselný věk ani slova o věku ('6-year-old', 'toddler') — jen vlasy, oči, oblečení, doplňky, výraz tváře.",
    "- heroDescription ZAKONČI záznamem 'Heights:' s RELATIVNÍMI výškami všech postav BEZ věkových slov, např. 'Heights: Valentýna is the smallest and reaches Nicolas's waist; James is slightly taller than Nicolas; Jana and Jan are grown-ups, much taller than all the children.' Tím zůstanou velikosti těl konzistentní na všech obrázcích.",
    "- Pokud v příběhu vystupuje OPAKUJÍCÍ SE PŘEDMĚT (auto, kterým jedou, kouzelný předmět, oblíbená hračka), přidej do heroDescription záznam 'Key objects:' s jeho PŘESNÝM vzhledem ('an old sky-blue pickup truck with a rusty crane, round friendly headlight eyes'). V imagePromptech na něj odkazuj JEDNÍM krátkým stálým označením (např. 'the sky-blue pickup truck') — plný popis se do obrázkového modelu vkládá automaticky. Předmět NIKDY nemění typ, tvar ani barvu mezi scénami — stejné auto zůstává stejným autem celou pohádku.",
    "- SPORTOVNÍ VYBAVENÍ JE VŽDY KEY OBJECT: když postava jede na kole, lyžuje, plave apod., zamkni vybavení v 'Key objects:' s přesným typem a barvami (anglicky, např. 'a black triathlon time-trial bike with aero handlebars and deep black racing wheels'). Časovkářské kolo se nikdy nezmění v silniční.",
    "- Pokud děj vyžaduje JINÉ OBLEČENÍ než kanonický popis postavy (sport, zima, plavání, kostým), NEUPRAVUJ záznam postavy — přidej samostatný záznam 'Story outfits:', např. 'Story outfits: Jan wears a sleeveless navy-and-white triathlon suit with a red stripe and white cycling shoes — IDENTICAL in every scene (overrides his default clothing).' Jeden převlek na postavu pro CELÝ příběh.",
    "- Pokud jsou přiloženy referenční fotografie, popiš přesně co vidíš na fotce.",
    "- Tyto popisy se NIKDY nemění napříč scénami.",
    "",
    "═══ STRUKTURA PŘÍBĚHU ═══",
    "- Scéna 1: Uveď svět a HÁČEK — tajemství, otázku nebo problém, který čtenáře okamžitě vtáhne.",
    "- Scény 2 až N-1: Stoupající děj se zvyšujícím se napětím; zahrň alespoň JEDNO nečekané překvapení (pomocník, který se ukáže být zdrojem problému, zkratka vedoucí na kouzelné místo, přítel, který všechny překvapí).",
    "- Překvapení musí být ZASLOUŽENÉ — zasej nápovědu nebo zárodek dříve v příběhu.",
    "- SKUTEČNÁ SÁZKA: v ohrožení musí být něco, na čem hrdinovi opravdu záleží (kamarád ztracený v mlze, poslední zhasínající lucernička, téměř prohraný závod) — přiměřeně věku, žádná krutost, ale nebezpečí musí být CÍTIT.",
    "- TEMNÝ OKAMŽIK: kolem 70–80 % příběhu přijde nejnižší bod — plán selže, naděje pohasíná… Nech ho chvíli DOZNÍT (jedna tichá scéna), než hrdina najde odvahu, pomoc kamaráda nebo dříve zasetou nápovědu. Rozuzlení pak působí zaslouženě a hřejivě.",
    "- Protagonista se musí do konce ZMĚNIT nebo NAUČIT něco smysluplného.",
    "- Scény by měly odkazovat na dřívější události (ohlasy): 'kouzelná houba ze scény 2 je zachrání ve scéně 6'.",
    "- VYHNI SE: epizodické scény, které nesouvisí; zřejmá řešení; formulové 'a žili šťastně' konce bez zasloužení.",
    "- Emoční oblouk: úžas → napětí → naděje → překvapení → zasloužené rozuzlení.",
    "",
    "═══ IMAGE PROMPTS ═══",
    "- Psát ANGLICKY, max 60 slov. Drž je KRÁTKÉ — heroDescription (appearance lock) se do obrázkového modelu vkládá automaticky u každé scény, NEKOPÍRUJ sem popisy postav.",
    "- Postavy jen JMÉNEM; popiš: akci scény, pózy, výraz tváře, prostředí, náladu, osvětlení.",
    "- Ukonči: 'Only [jména v této scéně] present — no other people or background figures.'",
    "- Nepřidávej stylové pokyny (Disney/storybook styl se připojuje automaticky).",
    "- Žádné věkové číslice ani věkově specifické výrazy.",
    "",
    "═══ SOUNDSCAPE ═══",
    "Každá scéna má `soundscape` – vyberte podle nálady scény (POVINNÉ):",
    '  "magic"     — kouzla, magie, víly, zázraky, kouzelné předměty',
    '  "forest"    — příroda, les, louka, zvířata, venku, zahrada',
    '  "night"     — noc, hvězdy, měsíc, spánek, sny, večer',
    '  "adventure" — pohyb, dobrodružství, výzva, nebezpečí, záchrana',
    '  "cozy"      — domov, jídlo, objetí, bezpečí, rodina, teplo, konec pohádky',
    "",
    "═══ VÝSTUP ═══",
    "Odpověz POUZE validním RFC 8259 JSON — bez markdown, bez ``` obalení, bez // komentářů, bez trailing čárek.",
    "Povinné pole na každou scénu: index (číslo), narration (string), imagePrompt (string), soundscape (jedna z 5 hodnot).",
    "Příklad struktury (vyplň reálným obsahem):",
    '{"title":"...","heroDescription":"...","scenes":[{"index":1,"narration":"...","imagePrompt":"...","soundscape":"magic"},{"index":2,"narration":"...","imagePrompt":"...","soundscape":"forest"}]}',
  ].join("\n");
}

function buildUserPrompt(req: StoryRequest, extras: StoryExtras = {}): string {
  const lang = (req.language === "en" ? "en" : "cs") as "cs" | "en";
  const en = lang === "en";

  const allChars: Character[] = [
    ...req.characters,
    ...(extras.customCharacters || []).map((cc) => ({
      id: cc.id,
      name: cc.name,
      description: cc.description,
    })),
  ];

  // V anglickém vyprávění vystupují postavy pod anglickou podobou jména
  const displayName = (c: { name: string; nameEn?: string }) =>
    req.language === "en" && c.nameEn ? c.nameEn : c.name;
  const cast = allChars.map((c) => `- ${displayName(c)}: ${c.description}`).join("\n");

  const hasNicky = allChars.some((c) => c.id === "nicolas");
  const hasValentyna = allChars.some((c) => c.id === "valentyna");
  const hasParents = allChars.some((c) => c.id === "jan" || c.id === "jana");

  const familyContext = en
    ? [
        hasNicky && hasValentyna
          ? "Nicolas is Valentýna's older brother and is visibly taller than her — consistently across all illustrations."
          : "",
        hasNicky && hasValentyna
          ? "The siblings cooperate; the older one helps the younger – the older-sibling dynamic is part of the character."
          : "",
        hasParents && (hasNicky || hasValentyna)
          ? "Parents are a loving support – they help in the story but let the children experience the adventure."
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    : [
        hasNicky && hasValentyna
          ? "Nicolas je Valentýnin starší bratr a je viditelně vyšší — konzistentně na všech obrázcích."
          : "",
        hasNicky && hasValentyna
          ? "Sourozenci spolupracují, starší pomáhá mladší – dynamika staršího sourozence je součástí charakteru."
          : "",
        hasParents && (hasNicky || hasValentyna)
          ? "Rodiče jsou láskyplnou oporou – v příběhu pomáhají, ale nechávají děti zažít dobrodružství."
          : "",
      ]
        .filter(Boolean)
        .join(" ");

  const ageNote = en
    ? req.age <= 3
      ? "Very simple sentences (max 8 words), lots of repetition, soothing rhythm."
      : req.age <= 5
      ? "Short sentences, concrete images, magical and playful."
      : "Sentences may be longer; the story may have mild tension and humour."
    : req.age <= 3
    ? "Velmi jednoduché věty (max 8 slov), hodně opakování, uklidňující rytmus."
    : req.age <= 5
    ? "Krátké věty, konkrétní obrazy, kouzelné a hravé."
    : "Věty mohou být delší, příběh může mít mírné napětí a humor.";

  const lines = en
    ? [
        req.themeName ? `World / theme: ${req.themeName}` : "",
        req.themePrompt || "",
        req.topic ? `Wish / plot: ${req.topic}` : "",
        `Characters:`,
        cast,
        familyContext,
        `Target audience age: ${req.age} years. ${ageNote}`,
        `Number of scenes: ${req.sceneCount}`,
        `Narration language: English`,
        "",
        "IMPORTANT for imagePrompts: keep them short — name the characters present, their action",
        "and the scene's environment. Facial expression must match the scene's emotion.",
      ]
    : [
        req.themeName ? `Svět / téma: ${req.themeName}` : "",
        req.themePrompt || "",
        req.topic ? `Přání / zápletka: ${req.topic}` : "",
        `Postavy:`,
        cast,
        familyContext,
        `Věk hlavního publika: ${req.age} let. ${ageNote}`,
        `Počet scén: ${req.sceneCount}`,
        `Jazyk vyprávění: čeština`,
        "",
        "DŮLEŽITÉ pro imagePrompty: drž je krátké — vyjmenuj přítomné postavy, jejich akci",
        "a prostředí scény. Výraz tváře musí odpovídat emoci scény (radost, úžas, napětí, klid...).",
      ];

  if (req.moral) {
    lines.push(
      "",
      en
        ? `MORAL OF THE STORY: the tale must naturally convey this lesson: "${req.moral}" Never preach — the lesson must emerge from the plot and the heroes' own choices. In the final scene the narrator may voice it gently in ONE short sentence at most.`
        : `PONAUČENÍ: pohádka má přirozeně předat toto ponaučení: „${req.moral}“ Nikdy nekázej — ponaučení musí vyplynout z děje a z vlastních rozhodnutí hrdinů. V poslední scéně ho vypravěč smí jemně vyslovit NEJVÝŠ jednou krátkou větou.`
    );
  }

  if (req.previousStory) {
    lines.push(
      "",
      en
        ? `SEQUEL: this is a new installment of the earlier tale "${req.previousStory.title}". What happened last time: ${req.previousStory.text}`
        : `POKRAČOVÁNÍ: toto je další díl dřívější pohádky „${req.previousStory.title}“. Co se stalo minule: ${req.previousStory.text}`,
      en
        ? "Write a NEW, self-contained adventure that follows on: the heroes remember the previous events and reference them at least once (a callback), but the plot, problem and twist are NEW. Give the story a NEW title — never reuse the previous one."
        : "Napiš NOVÉ, samostatné dobrodružství, které navazuje: hrdinové si minulé události pamatují a alespoň jednou na ně odkážou (callback), ale zápletka, problém i zvrat jsou NOVÉ. Dej pohádce NOVÝ název — nikdy nepoužij ten minulý."
    );
  }

  if (req.twoEndings) {
    lines.push(
      "",
      en
        ? [
            "TWO ENDINGS (interactive tale): the story has a SHARED plot and TWO different endings.",
            "- The fork comes at about 60–70% of the story — NEVER right before the last page. 'scenes' = the shared plot (about two thirds) + ENDING A (the remaining ~third, AT LEAST 2 scenes, ideally 3–4).",
            "- The LAST SHARED scene builds up a real dilemma, and its narration's VERY LAST sentence is the narrator asking the listener a direct question that names BOTH paths (e.g. 'And what do you think — should they follow the firefly deeper into the woods, or run home to tell Dad?'). Nothing comes after the question — the story stops there and waits for the child's choice.",
            '- Add a top-level field "choice": {"afterScene": <number of the last shared scene>, "options": ["short label of path A (3–5 words)", "short label of path B"], "altScenes": [scenes of ENDING B — SAME number of scenes as ending A, same JSON structure, index continuing after the last scene]}.',
            "- BOTH endings are warm, complete and satisfying full story arcs — they differ in the path, never in quality. Both honour the moral if one is set.",
            "- altScenes imagePrompts follow the SAME appearance rules as all other scenes.",
          ].join("\n")
        : [
            "DVA KONCE (interaktivní pohádka): příběh má SPOLEČNÝ děj a DVA různé konce.",
            "- Rozdvojení přichází zhruba v 60–70 % příběhu — NIKDY až těsně před poslední stránkou. 'scenes' = společný děj (asi dvě třetiny) + KONEC A (zbylá ~třetina, NEJMÉNĚ 2 scény, ideálně 3–4).",
            "- POSLEDNÍ SPOLEČNÁ scéna vygraduje skutečné dilema a ÚPLNĚ POSLEDNÍ věta její narration je otázka vypravěče přímo posluchači, která jmenuje OBĚ cesty (např. „A co myslíš ty — mají jít za světluškou hlouběji do lesa, nebo běžet domů za tatínkem?“). Po otázce už nic nenásleduje — příběh se tam zastaví a čeká na volbu dítěte.",
            '- Přidej pole "choice": {"afterScene": <číslo poslední společné scény>, "options": ["krátký popisek cesty A (3–5 slov)", "krátký popisek cesty B"], "altScenes": [scény KONCE B — STEJNÝ počet scén jako konec A, stejná struktura, index navazuje za poslední scénou]}.',
            "- OBA konce jsou vřelé, uzavřené a plnohodnotné příběhové oblouky — liší se cestou, nikdy kvalitou. Oba ctí ponaučení, pokud je zadané.",
            "- imagePrompty altScenes dodržují STEJNÁ pravidla vzhledu jako všechny ostatní scény.",
          ].join("\n")
    );
  }

  if (extras.inspirationUrlText) {
    lines.push("", "Doplňující kontext z webové stránky:", extras.inspirationUrlText.slice(0, 1500));
  }
  if (extras.inspirationImages && extras.inspirationImages.length > 0) {
    lines.push(
      "",
      `Přiložen(y) ${extras.inspirationImages.length} inspirační obrázek/ky – použij pro atmosféru a vizuální styl.`
    );
  }
  if (extras.inspirationPdfBase64) {
    lines.push("", "Přiložené PDF použij jako inspiraci pro obsah nebo styl příběhu.");
  }
  if (extras.customCharacters && extras.customCharacters.length > 0) {
    const withPhoto = extras.customCharacters.filter((c) => c.photoBase64);
    if (withPhoto.length > 0) {
      lines.push(
        "",
        `Přiložen(a) ${withPhoto.length} fotka/ky vlastních postav – zachovej jejich přesný vzhled v celém příběhu.`
      );
    }
  }

  return lines.filter(Boolean).join("\n");
}

function sanitizeJson(s: string): string {
  // Strip JS-style // line comments (outside strings) — Claude sometimes adds them
  s = s.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*/g, (m, str) => str ?? "");
  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, "$1");
  return s;
}

function parseScript(raw: string): StoryScript {
  // Strip code fences
  let cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  // Sanitize before finding braces
  cleaned = sanitizeJson(cleaned);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    if (cleaned.length > 200) {
      throw new Error("Příběh byl příliš dlouhý nebo byl výstup oříznut — zkus méně stránek.");
    }
    throw new Error("Claude nevrátil JSON. Začátek odpovědi: " + raw.slice(0, 200));
  }
  let parsed: StoryScript;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1)) as StoryScript;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Chyba při zpracování příběhu (${msg}) — zkus to znovu.`);
  }
  if (!parsed.scenes || parsed.scenes.length === 0) {
    throw new Error("Claude nevrátil žádné scény — zkus to znovu.");
  }
  parsed.scenes = parsed.scenes.map((s, i) => ({ ...s, index: i + 1 }));
  // 🔀 Dva konce: validace — vadná/neúplná větev se tiše zahodí (pohádka
  // pak má normální jeden konec, generování nespadne)
  if (parsed.choice) {
    const c = parsed.choice;
    const ok =
      Number.isFinite(c.afterScene) &&
      c.afterScene >= 1 && c.afterScene < parsed.scenes.length &&
      Array.isArray(c.options) && c.options.length === 2 &&
      c.options.every(o => typeof o === "string" && o.trim()) &&
      Array.isArray(c.altScenes) && c.altScenes.length >= 1 &&
      c.altScenes.every(s => s && typeof s.narration === "string" && typeof s.imagePrompt === "string");
    if (ok) {
      c.afterScene = Math.round(c.afterScene);
      c.options = [String(c.options[0]).slice(0, 60), String(c.options[1]).slice(0, 60)];
      c.altScenes = c.altScenes.map((s, i) => ({ ...s, index: parsed.scenes.length + i + 1 }));
    } else {
      console.warn("[Claude] choice branch invalid — falling back to single ending");
      delete parsed.choice;
    }
  }
  return parsed;
}

type AnthropicPart =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

// Strip non-printable chars from env vars — belt-and-suspenders before setting HTTP headers
function sanitizeApiKey(key: string | undefined): string {
  return (key || "").replace(/[^\x20-\x7E]/g, "").trim();
}

async function callAnthropicApi(body: object): Promise<string> {
  const apiKey = sanitizeApiKey(process.env.ANTHROPIC_API_KEY);
  if (!apiKey) throw new Error("Chybí ANTHROPIC_API_KEY.");

  // Use native fetch (Node 18+) — avoids node:https header-char validation quirks.
  // 429/529 (rate limit / overload) se zkouší znovu — fronta pohádek posílá
  // víc požadavků najednou.
  let res: Response | null = null;
  let text = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(250_000),
    });
    text = await res.text();
    if (res.status !== 429 && res.status !== 529) break;
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 12_000;
    console.warn(`[Claude] ${res.status}, retry in ${waitMs / 1000}s (attempt ${attempt + 1})`);
    await new Promise(r => setTimeout(r, waitMs));
  }
  if (!res) throw new Error("Anthropic: no response");
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${text.slice(0, 400)}`);

  let data: { content?: Array<{ type: string; text?: string }>; error?: { message?: string } };
  try { data = JSON.parse(text); }
  catch { throw new Error("Anthropic JSON parse error: " + text.slice(0, 200)); }

  if (data.error) throw new Error(`Anthropic error: ${data.error.message}`);

  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock?.text) throw new Error("Claude nevrátil text. Odpověď: " + text.slice(0, 200));
  return textBlock.text;
}

/** Vymyslí jeden hravý námět na pohádku (1–2 věty) — pro tlačítko 🎲 v UI. */
export interface TopicIdeaContext {
  /** Vybraný svět pohádky — námět se musí odehrávat v něm */
  themeName?: string;
  themePrompt?: string;
  /** Co už má uživatel napsané v poli přání — námět na tom staví */
  userHint?: string;
}

export async function suggestTopicIdea(language: "cs" | "en", characterNames: string[], ctx: TopicIdeaContext = {}): Promise<string> {
  const model = MODEL.trim();
  const who = characterNames.length ? characterNames.join(", ") : language === "en" ? "the children" : "děti";
  const worldPart = ctx.themeName
    ? language === "en"
      ? ` The story MUST take place in this world: ${ctx.themeName}.${ctx.themePrompt ? ` World guide: ${ctx.themePrompt.slice(0, 800)}` : ""} Use this world's places and well-known characters alongside the featured heroes.`
      : ` Námět se MUSÍ odehrávat v tomto světě: ${ctx.themeName}.${ctx.themePrompt ? ` Průvodce světem: ${ctx.themePrompt.slice(0, 800)}` : ""} Využij místa a známé postavy tohoto světa spolu s uvedenými hrdiny.`
    : "";
  const hintPart = ctx.userHint
    ? language === "en"
      ? ` Build on the user's notes and include them in the idea: "${ctx.userHint.slice(0, 300)}".`
      : ` Vyjdi z poznámek uživatele a zapracuj je do námětu: „${ctx.userHint.slice(0, 300)}".`
    : "";
  const prompt = language === "en"
    ? `Suggest ONE playful, original bedtime-story idea (1-2 sentences, max 40 words) for small children, featuring: ${who}.${worldPart}${hintPart} Make it concrete and magical (a place, a problem, a twist seed). Reply with ONLY the idea text — no quotes, no intro. Vary wildly: pick an unexpected setting or magical object.`
    : `Navrhni JEDEN hravý, originální námět na pohádku před spaním (1–2 věty, max 40 slov) pro malé děti, kde vystupují: ${who}.${worldPart}${hintPart} Ať je konkrétní a kouzelný (místo, problém, zárodek překvapení). Odpověz POUZE textem námětu — bez uvozovek, bez úvodu. Buď pokaždé jiný: vyber nečekané prostředí nebo kouzelný předmět.`;
  const raw = await callAnthropicApi({
    model,
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });
  return raw.trim().replace(/^["'„]|["'"]$/g, "");
}

// Nastudování vlastního světa: z popisu uživatele (a textu stažených odkazů)
// sestaví průvodce světem ve stylu THEMES promptů (anglicky, s CHARACTER
// REFERENCE). Když chybí podstatná informace, vrátí i JEDNU doplňující otázku.
export async function studyWorld(
  language: "cs" | "en",
  name: string,
  description: string,
  urlTexts: string[]
): Promise<{ prompt: string; question: string | null }> {
  const model = MODEL.trim();
  const sources = urlTexts.filter(Boolean).map((t, i) => `WEB SOURCE ${i + 1}:\n${t.slice(0, 2500)}`).join("\n\n");
  const prompt = [
    `You are defining a fairy-tale "world" for a children's story generator. The user wants their stories to take place in this world.`,
    `USER'S WORLD NAME: ${name || "(none)"}`,
    `USER'S DESCRIPTION: ${description.slice(0, 1500)}`,
    sources ? `FETCHED WEB CONTENT the user linked to:\n${sources}` : "",
    ``,
    `Write a world guide the story generator will follow. Format it like this, in ENGLISH:`,
    `1) One sentence: "Set the story in the world of X: ..." (setting, era, mood).`,
    `2) If the world has well-known characters (from the description, web content, or your own knowledge of this fairy tale/show/book), add "CHARACTER REFERENCE:" with each character's EXACT visual look (colors, clothing, size), separated by " | ".`,
    `3) One sentence about atmosphere/tone (gentle, adventurous...).`,
    `Max 180 words total. Recognize the fairy tale/show/book if you know it and use your knowledge of it.`,
    ``,
    language === "en"
      ? `If an essential detail is missing or ambiguous (which characters matter, what the world looks like), also ask ONE short clarifying question in ENGLISH — the user will answer and re-run. Otherwise question is null.`
      : `Pokud chybí podstatný detail nebo je popis nejednoznačný (které postavy jsou důležité, jak svět vypadá), polož navíc JEDNU krátkou doplňující otázku ČESKY — uživatel odpoví a nechá svět nastudovat znovu. Jinak je question null.`,
    ``,
    `Reply with ONLY valid JSON: {"prompt":"...","question":"..." or null}`,
  ].filter(Boolean).join("\n");
  const raw = await callAnthropicApi({
    model,
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude nevrátil JSON.");
  const parsed = JSON.parse(jsonMatch[0]) as { prompt?: string; question?: string | null };
  if (!parsed.prompt) throw new Error("Claude nevrátil popis světa.");
  return { prompt: parsed.prompt, question: parsed.question || null };
}

export async function generateStory(req: StoryRequest, extras: StoryExtras = {}): Promise<StoryScript> {
  const model = MODEL.trim();
  const parts: AnthropicPart[] = [];

  if (extras.inspirationPdfBase64) {
    parts.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: extras.inspirationPdfBase64 },
    });
  }

  for (const img of extras.inspirationImages || []) {
    parts.push({
      type: "image",
      source: { type: "base64", media_type: img.mimeType, data: img.data },
    });
  }

  for (const cc of extras.customCharacters || []) {
    if (cc.photoBase64 && cc.photoMimeType) {
      parts.push({
        type: "image",
        source: { type: "base64", media_type: cc.photoMimeType, data: cc.photoBase64 },
      });
    }
  }

  parts.push({ type: "text", text: buildUserPrompt(req, extras) });

  const content: string | AnthropicPart[] =
    parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts;

  const language = (req.language === "en" ? "en" : "cs") as "cs" | "en";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await callAnthropicApi({
      model,
      max_tokens: 16384, // 20 scén s vyprávěním a popisy obrázků se do 8k nevešlo
      system: buildSystemPrompt(language),
      messages: [{ role: "user", content }],
    });
    try {
      const script = parseScript(raw);
      // PRAVIDLO KONZISTENCE #1: vzhled známých postav je KANONICKÝ — vždy
      // doslova z reference/characters.json, ať Claude napsal cokoliv.
      // (Řeší „jednou blond, podruhé hnědé vlasy" mezi pohádkami.)
      script.heroDescription = enforceCanonicalAppearance(script.heroDescription || "", req, extras);
      return script;
    } catch (e) {
      if (attempt === 2) throw e;
      console.warn(`[Claude] JSON parse failed attempt ${attempt}, retrying: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new Error("Nepodařilo se vygenerovat příběh.");
}

// Přestaví heroDescription: popisy postav z kartotéky se přebírají DOSLOVA.
// VŠECHNO OSTATNÍ od Clauda ZŮSTÁVÁ — záznamy postav vymyšlených příběhem
// (Otesánek, drak…), vlastních postav, 'Key objects:', 'Story outfits:'
// i 'Heights:'. (Dřívější verze cizí záznamy vyhazovala → vymyšlené postavy
// neměly zámek vzhledu a na každé scéně vypadaly jinak.)
function enforceCanonicalAppearance(hero: string, req: StoryRequest, extras: StoryExtras = {}): string {
  const parts = hero.split("|").map(s => s.trim()).filter(Boolean);
  // Jména kanonických postav (cs + en varianta + jméno z popisu)
  const canonNames = new Set<string>();
  for (const c of req.characters) {
    if (c.name) canonNames.add(c.name.toLowerCase());
    if (c.nameEn) canonNames.add(c.nameEn.toLowerCase());
    const descName = c.description?.split(":")[0]?.trim().toLowerCase();
    if (descName) canonNames.add(descName);
  }
  const isCanonEntry = (p: string) => {
    const name = p.split(":")[0]?.trim().toLowerCase() ?? "";
    if (!name || name.length > 40) return false;
    for (const cn of canonNames) {
      if (name === cn || name.endsWith(" " + cn)) return true;
    }
    return false;
  };
  // Claudovy verze kanonických postav pryč (nahradí je doslovná kartotéka),
  // vše ostatní v původním pořadí zůstává
  const kept = parts.filter(p => !isCanonEntry(p));
  const canonical = req.characters.map(c => c.description).filter(Boolean);
  // Vlastní postava bez záznamu → doplnit z jejího popisu
  for (const cc of extras.customCharacters || []) {
    const has = kept.some(p => p.toLowerCase().startsWith(cc.name.toLowerCase() + ":"));
    if (!has && cc.description) kept.push(`${cc.name}: ${cc.description}`);
  }
  return [...canonical, ...kept].join(" | ");
}
