import type { StoryRequest, StoryScript, Character, Scene, Soundscape, SoundEffect } from "./types";

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
    /** Více fotek postavy (až 5) — mají přednost před photoBase64 */
    photos?: Array<{ data: string; mimeType: string }>;
  }>;
  inspirationImages?: Array<{ data: string; mimeType: string }>;
  inspirationPdfBase64?: string;
  inspirationUrlText?: string;
  /** Krátký souhrn vloženého PDF (nahrazuje celé PDF při psaní — rychlejší) */
  pdfBriefText?: string;
}

// 🌐 Testovací jazyky vyprávění: prompt jede na anglické kostře, jen samotná
// narrace se píše cílovým jazykem (heroDescription a imagePrompty zůstávají
// anglicky). Neznámý kód jazyka padá na češtinu (zpětná kompatibilita).
export const EXTRA_STORY_LANGS: Record<string, string> = {
  hr: "Croatian",
  da: "Danish",
  sk: "Slovak",
};

function storyLangName(language: string): string | null {
  if (language === "en") return "English";
  return EXTRA_STORY_LANGS[language] || null;
}

function buildSystemPrompt(language: string): string {
  const langName = storyLangName(language);
  if (langName) {
    return [
      `You are a kind, talented storyteller for children. You write the story narration in ${langName}.`,
      langName !== "English"
        ? `The 'narration' of every scene MUST be written in natural, fluent ${langName} (a native bedtime-story voice). Keep the characters' names unchanged. Everything else — title in ${langName}; heroDescription and imagePrompts ALWAYS in English.`
        : "",
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
      "- INVENTED CHARACTERS NEVER SHARE A NAME with anyone in the 'Characters:' list (even if that person doesn't appear in this particular story) — a family of moles or any other invented cast gets its OWN distinct names, never borrowed from the family roster. Reusing a family member's name for an unrelated invented creature risks the two identities getting mixed up.",
      "- DIRECTION OF ADAPTATION (CRITICAL): the canonical heroes' proportions, body size and art style are FIXED no matter who else shares the scene — when you invent supporting characters (an animal family, a creature, a crowd), THEY adapt their design to fit OUR heroes' established look and world, never the reverse. A hero never becomes smaller, more cartoonish, or differently styled just because non-canonical characters are present in the same scene.",
      "- Separate characters with ' | '",
      "- Be extremely specific — not 'blond hair' but 'straight light-blond hair'; not 'red shirt' but 'white T-shirt with two red horizontal stripes'.",
      "- DO NOT include age numbers or age words ('6-year-old', 'toddler') — only hair, eyes, clothing, accessories, facial features.",
      "- END heroDescription with a 'Heights:' entry stating the RELATIVE heights of all characters WITHOUT age words, e.g. 'Heights: Valentýna is the smallest — the top of her head reaches Nicolas's shoulders; James is exactly the same height as Nicolas; Jana and Jan are grown-ups, much taller than all the children.' This keeps body sizes consistent across every image.",
      "- IF THE PLOT ITSELF involves a character's height/size changing partway through (a growth spurt, magically shrinking, an injury, anything that changes body proportions ON PURPOSE) — this is NOT a consistency error, it must be drawn as a deliberate stage change: (1) the 'Heights:' entry states the STARTING relationship only (before the change), and (2) EVERY scene's imagePrompt from the change onward ends with an explicit override of the current relationship for THAT scene, e.g. '(Nicolas now stands noticeably taller than James, about half a head above him)'. Scenes before the change need no such note (the default Heights: applies). Never let the transformation show up gradually/randomly across unrelated scenes — it happens ONLY at the exact scene where the plot causes it, and every scene after stays at the NEW stage consistently.",
      "- FIGURATIVE growth is NOT physical growth: phrases like 'grows into a legend/star/hero' or 'grows braver' describe skill, fame or confidence, NOT a literal change in age or body size — unless the plot has one CONCRETE, named transformation event (a specific magic food, spell, or injury), draw the character at their canonical child size/age in EVERY single scene, including the very last one. Never let a character quietly look older or taller in a late-story 'triumphant' or 'grown-up' scene without such an explicit event.",
      "- If the story features a RECURRING OBJECT (the car they travel in, a magic item, a favourite toy, or ANY everyday prop a character repeatedly carries/steals/uses — a basket, a cooking pot, a lantern, a tool — however small or mundane), add a 'Key objects:' entry to heroDescription with its EXACT appearance AND, if the character has more than one, the EXACT COUNT ('a single battered copper pot' vs 'three mismatched wooden baskets'). In imagePrompts refer to it by ONE short fixed tag (e.g. 'the sky-blue pickup truck', 'the copper pot') — the full description is injected into the image model automatically. The object NEVER changes type, shape, color OR COUNT between scenes — a single pot never multiplies into several in one image or across scenes, the same car stays the same car for the whole story.",
      "- SPORTS EQUIPMENT IS ALWAYS A KEY OBJECT: if a character rides a bike, skis, swims etc., lock the equipment in 'Key objects:' with exact type and colors (e.g. 'a black triathlon time-trial bike with aero handlebars and deep black racing wheels'). A time-trial bike never becomes a road bike.",
      "- If the plot requires DIFFERENT CLOTHING than a character's canonical description (sports, winter, swimming, costume), do NOT edit the character entry — add a separate 'Story outfits:' entry instead, e.g. 'Story outfits: Jan wears a sleeveless navy-and-white triathlon suit with a red stripe and white cycling shoes — IDENTICAL in every scene (overrides his default clothing).' One outfit per character for the WHOLE story.",
      "- WEATHER & SEASON LOGIC (MANDATORY): decide the season and climate from the setting. If it is NOT mild weather, give EVERY character a weather WARDROBE in the 'Story outfits:' entry with TWO fixed variants: 'outdoors: ...' (snow/winter → warm winter jacket, hat, scarf, gloves, snow boots; hot summer/beach → light clothes, sandals, swimsuits when swimming; rain → raincoat and rubber boots) and 'indoors: ...' (what they wear underneath — usually their canonical clothes, jacket and hat taken off). Keep each character's signature colors so they stay recognizable (a boy known for a white T-shirt with red stripes gets a red-and-white striped winter hat). Each variant is IDENTICAL every time it appears — the same jacket in every outdoor scene.",
      "- EVERY imagePrompt must END with the dressing state of THAT scene, matching where it takes place: '(everyone in their outdoor winter clothes)' outdoors, or '(indoors — jackets and hats off)' inside buildings. ALL characters in one scene are dressed for the SAME conditions — NEVER one bundled up in a coat while another wears a T-shirt in the same place. Never summer clothes in snow, never winter coats on a beach or inside a warm room.",
      "- GROUP UNIFORMS (MANDATORY whenever the story has two or more GROUPS that should look distinct and internally consistent — sports teams, rival schools, kingdoms, guilds, clubs, gangs, uniformed staff, NOT just literal sports matches): add a 'Team kits:' entry to heroDescription that locks each group's EXACT uniform/colors (e.g. 'Team kits: Nicolas's team wears a red shirt with white sleeves, white shorts, red socks; opponents wear light-blue-and-white striped shirts, black shorts.' or 'Team kits: Sunnyvale Knights wear gold-and-blue tunics; Riverbend Foxes wear green-and-grey tunics.'). EVERY imagePrompt for a scene where the group activity is happening must END with which uniform is worn: '(Nicolas and teammates in their team kit)', or '(Nicolas in his everyday clothes, off duty)' when the scene is away from that activity — never a mix of uniform and everyday clothes among people in the SAME group scene at the SAME time.",
      "- SCOREBOARDS AND DISPLAYS: a scoreboard may show ONLY the score as plain digits (e.g. '2:1') — NEVER team-name abbreviations, country codes, or any other letters/words on it or anywhere else in the image.",
      "- If reference photos are attached, describe what you SEE in the photo exactly.",
      "- These descriptions NEVER change across scenes.",
      "- PRONUNCIATION HINTS: whenever you INVENT a name (a character, place, food, object) whose spelling a text-to-speech voice could plausibly mispronounce in the narration's language (foreign-looking letter combinations, made-up words, puns) — end heroDescription with one extra entry using EXACTLY this label: 'Pronunciation hints: Written→SaysAs; Written2→SaysAs2' (pairs separated by ';', arrow is a real → character). SaysAs must be spelled the way that same language's reader would pronounce it correctly ALOUD — it is used ONLY for the spoken narration, never shown to the reader, so it does not need to look like a real word. Skip this entry entirely if no invented name needs it.",
      "",
      "═══ STORY STRUCTURE ═══",
      "- Scene 1: Establish the world and a HOOK — a mystery, question, or problem that immediately draws the reader in.",
      "- Scenes 2 to N-1: Rising action with increasing stakes; include at least ONE unexpected twist (a helper who turns out to be the problem, a shortcut that leads somewhere magical, a friend who surprises everyone).",
      "- The twist must feel EARNED — plant a clue or seed earlier in the story.",
      "- REAL STAKES: something the hero truly cares about must be at risk (a friend lost in the fog, the last lantern going out, the race almost lost) — age-appropriate, no gore, but the danger must FEEL real.",
      "- THE DARK MOMENT: around 70–80% of the story comes the lowest point — the plan fails, hope flickers... Let it BREATHE for a beat (one quiet scene) before the hero finds courage, a friend's help, or the clue planted earlier. Then the resolution feels earned and warm.",
      "- The protagonist must CHANGE or LEARN something meaningful by the end.",
      "- Scenes should reference earlier events (callbacks): 'the magic mushroom from scene 2 now saves them in scene 6'.",
      "- CAUSAL CHAIN (CRITICAL): consecutive scenes connect by 'THEREFORE' or 'BUT' — never by 'and then'. Every scene is a CONSEQUENCE of the previous one or a complication of it; if a scene could be removed without breaking the chain, it does not belong in the story.",
      "- RULE OF THREE WITH ESCALATION: the hero tries to solve the problem THREE times — attempt 1 fails small, attempt 2 fails bigger (stakes rise each time), attempt 3 succeeds ONLY thanks to what the hero learned from the first two failures. Each attempt must be genuinely DIFFERENT, not the same action repeated.",
      "- STAKES ONLY RISE: every obstacle is BIGGER than the one before it; never solve a problem and then introduce a smaller one. A problem once SOLVED stays solved — it never silently comes back.",
      "- NO DEUS EX MACHINA: the climax is resolved by the HERO using something already established earlier (a skill, an object, a friend, a lesson) — never by a new character, new magic, or a lucky coincidence appearing at the last moment. No new characters after the story's midpoint.",
      "- BEDTIME DECELERATION: after the climax the energy winds DOWN scene by scene — the final scene is calm, warm and sleepy (home, safety, a hug, closing eyes), so the listener drifts toward sleep.",
      "- AVOID: episodic scenes that don't connect; obvious solutions; formulaic 'and everyone was happy' endings without earning it.",
      "- Emotional arc: wonder → tension → hope → surprise → earned resolution → calm.",
      "",
      "═══ AVOID OVERUSED TROPES (IMPORTANT) ═══",
      "- Do NOT default to the same handful of go-to devices: magical sparkling dust that fixes everything, a magic coin/amulet/pendant that grants wishes, a moral that boils down to 'do it with a kind/good heart', or a house/toy/object that turns out to secretly have a heart or feelings. These are fine ONLY when the user's own topic, world, or theme specifically calls for that kind of magic — otherwise resolve the plot through a DIFFERENT engine: a mystery solved with clues and deduction, a skill practiced and improved, a misunderstanding untangled through honest conversation, a real-world obstacle (weather, distance, something broken, a disagreement) overcome through effort/cleverness/teamwork, a competition, an exploration or discovery.",
      "- MATCH THE GENRE THE WORLD/THEME IMPLIES: a selected world (pirates, space, detectives, dinosaurs, a real place, a sport) carries its OWN genre conventions — use them instead of defaulting back to generic fairy-tale magic regardless of the world. A detective world resolves through clues and reasoning; a sports world through practice, strategy and teamwork; a space world through problem-solving and courage; a real-place/everyday-life world through resourcefulness and human connection — no magic object required just because it's a children's story.",
      "- VARY THE THEME ACROSS STORIES for the same reader: kindness is ONE possible theme among many (courage, curiosity, honesty, perseverance, friendship, resourcefulness, patience, forgiveness, teamwork, responsibility) — when the user hasn't requested a specific moral, do not let every story quietly default to the same 'kind heart' message. Pick a theme that fits THIS plot and world, not a generic default.",
      "- FIT THE RESOLUTION TO THE AGE PROFILE below: younger children respond well to concrete, simple cause-and-effect resolutions; older children can enjoy a resolution built on cleverness, planning, or a genuinely earned realization — neither needs to lean on magic as a crutch.",
      "",
      "═══ IMAGE PROMPTS ═══",
      "- Write in ENGLISH, max 60 words. Keep them SHORT — heroDescription (the appearance lock) is injected into the image model automatically with every scene, so do NOT copy character descriptions here.",
      "- Refer to characters by NAME only, describe: scene action, poses, facial emotion, setting, mood, lighting.",
      "- SMALL GROUPS ONLY (CRITICAL for picture quality): each scene shows AT MOST 4 named characters (a large cast rotates across scenes — different smaller groups; the rest are simply elsewhere in the story at that moment). Only the FINAL scene may show up to 6. NEVER write 'everyone', 'the family', 'the friends', 'all of them' in an imagePrompt — always list the exact names of ONLY those visible. A background GROUP is the one exception: you MAY explicitly add e.g. 'other players of both teams in the background' or 'a cheering crowd in the distance' — it will be painted as small distant figures.",
      "- GATHERING EXCEPTION to the cap above: when the narration explicitly says a group of named characters comes together, reunites, or gathers in one place (not merely 'happens to be nearby') — e.g. everyone arriving home, the whole family sitting down together, friends reuniting — the imagePrompt for THAT scene MUST name EVERY one of them explicitly, up to 6 (the same ceiling as the final scene). If the full cast for that moment would exceed 6, name the 6 characters most central to the plot and put the rest in as an unnamed background group (e.g. 'other family members in the background') rather than dropping them silently. A reunion where someone is invisible reads as wrong, but so does an overcrowded, hard-to-render picture — this exception applies only to the scene(s) describing the gathering itself, not to every scene involving that group afterward.",
      "- NARRATION AND IMAGE MUST MATCH: whatever the narration describes as present/visible in THIS scene (an animal, its babies, a creature, an object) MUST also appear in the imagePrompt, even if it has no proper name — e.g. narration mentioning piglets snuffling in the mud means the imagePrompt must say so too ('...piglets snuffling in the mud nearby'). Never let something the listener just heard about be invisible in the picture.",
      "- NEVER NARRATE A SPECIFIC ABSENCE the picture cannot guarantee: do NOT write lines like 'not even the moon shone', 'no stars in the sky', 'not a single light was on' — the illustration model draws its own atmospheric sky/lighting by default and will very likely include exactly the thing you just said was missing, contradicting the text the child just heard. Describe what IS present and felt (warmth, firelight, closeness) instead of what specifically ISN'T. If the plot truly requires total darkness/no moon as a plot point, say so AND add a matching lock to that scene's imagePrompt ('a moonless, pitch-black sky').",
      "- End with: 'Only [names in this scene] present — no other people or background figures.' (unnamed animals/creatures from the rule above are not 'people' and don't break this — just add them before this closing sentence, e.g. '...piglets in the background. Only Nicolas and Valentýna present — no other people or background figures.')",
      "- Do not add style directions (Disney/storybook style is appended automatically).",
      "- No age numbers or age-specific terms.",
      "",
      "═══ STORY BIBLE (worldNotes) — study the world BEFORE writing ═══",
      "Add a top-level field \"worldNotes\" (ENGLISH, max 110 words): a factual guide to THIS story's world that every scene and every illustration must respect.",
      "- (1) SETTING LOCK: describe the recurring venue(s) EXACTLY and keep them consistent (e.g. 'matches take place ON a green grass football pitch with white painted lines and two goals with white nets, small stands beside it; the river is visible BEYOND the pitch — never as the playing surface'). Every scene that logically happens at that venue must name it in its imagePrompt.",
      "- (2) REAL-WORLD CORRECTNESS: apply how the activity really looks and works (a football match has TWO teams in clearly DIFFERENT kits, a referee, opponents ON the pitch, one round ball; a hospital has doctors in scrubs…). Match/competition scenes MUST include the opponents as a background group.",
      "- (3) REAL PEOPLE mentioned by name (athletes, celebrities — e.g. Lionel Messi) are real HUMAN BEINGS: give each a full HUMAN entry in heroDescription (hair, face, kit, build) like any other character. NEVER draw a literal pun on a name — Messi is a man, not a lion.",
      "- (4) CINEMATOGRAPHY: vary the camera across scenes like a good documentary — wide establishing shot, action close-up, over-the-shoulder, celebration crowd shot — while the venue and characters stay identical.",
      "- (5) RULES OF THIS WORLD (canon): state in one sentence how this story's special element works (what the magic can and cannot do, what the machine needs, what the animal understands) — and NEVER break it later. The climax solution must obey these rules; if the world comes from a known franchise or real domain, follow its established canon faithfully.",
      "",
      "═══ SOUNDSCAPE ═══",
      "Every scene has a `soundscape` – choose based on scene mood (REQUIRED):",
      '  "magic"     — spells, magic, fairies, wonders, enchanted objects',
      '  "forest"    — nature, forest, meadow, animals, outdoors, garden',
      '  "night"     — night, stars, moon, sleep, dreams, evening',
      '  "adventure" — movement, adventure, challenge, danger, rescue',
      '  "cozy"      — home, food, hugs, safety, family, warmth, story ending',
      "",
      "═══ SOUND EFFECT (sfx) ═══",
      "Optional `sfx` field on a scene — a ONE-SHOT sound effect for something the NARRATION OF THAT SCENE explicitly describes happening RIGHT THEN, on top of the ambient soundscape. This covers ANY scene where a specific sound-making object or action is the center of that moment — an instrument being played, a bell rung, a book's pages turning, a key turning in a lock, swords clashing, someone whistling a tune — the categories below are examples of the PATTERN, not an exhaustive list of situations; but the `sfx` VALUE itself must always be the single closest key from this list (never invent a key that isn't listed).",
      "SFX SHOULD BE THE DEFAULT, NOT THE EXCEPTION: aim for roughly 70-90% of scenes to carry an sfx (for a typical 10-scene story that's about 7-9 scenes; scale up for longer stories, down only for very short ones) — a story with hardly any sfx sounds flat and lifeless. Don't just look for sfx opportunities in scenes you already planned — actively WRITE the scenes (plot beat, character action, imagePrompt) so they naturally CONTAIN a sound-making moment: a character playing an instrument, an animal reacting, a door creaking, rain starting, a gasp of surprise, a page turning. Vary the CATEGORY scene to scene (animal, then object, then weather, then an emotion, then a machine…) — don't lean on the same one or two categories the whole story. Only skip `sfx` for the rare scene where truly nothing sound-worthy happens, and never pick more than one per scene:",
      '  WEATHER/WATER: "waves" (sea/ocean lapping or crashing) · "water_flow" (a calm river, stream or fountain flowing/trickling nearby — use this, NOT "waves", for rivers like the Vltava, streams, brooks and fountains) · "thunder" (thunder/lightning striking) · "wind_gust" (a gust or steady breeze of wind — use whenever the scene mentions wind, leaves rustling in the breeze, hair/clothes blowing) · "rain" (rain falling) · "snow_crunch" (footsteps crunching in snow)',
      '  NATURE/PLACES: "campfire_crackle" (a campfire crackling nearby) · "waterfall" (a waterfall rushing in the distance) · "cave_drip" (water dripping in a cave) · "leaves_crunch" (footsteps through fallen autumn leaves) · "volcano_rumble" (a distant volcanic rumble) · "desert_wind" (dry wind over sand)',
      '  ANIMALS (the animal itself makes its sound in THIS scene): "cow" (moo) · "pig" (oink) · "chicken" (cluck) · "sheep" (bleat) · "horse" (neigh) · "duck" (quack) · "dog" (bark) · "cat" (meow) · "frog" (croak) · "owl" (hoot) · "rooster" (crow) · "bee" (buzzing) · "rabbit" (soft hop/sniff) · "elephant" (trumpet) · "bear" (gentle friendly grumble/huff) · "mouse" (squeak) · "bird" (chirp/tweet) · "squirrel" (chatter) · "fox" (soft yip-bark) · "wolf" (a gentle distant howl) · "monkey" (chatter/hoot) · "seagull" (cry) · "dolphin" (click/whistle) · "cricket" (chirping at night)',
      '  MACHINES/TRAVEL: "car_engine" (a car engine starting/running) · "train" (a train chugging/whistling) · "boat_horn" (a boat/ship horn) · "clock_tick" (a clock ticking) · "doorbell" (a doorbell or knock) · "phone_ring" (a phone ringing) · "airplane" (a small plane flying overhead) · "bicycle_bell" (a bicycle bell) · "rocket_launch" (a toy-like rocket launching) · "helicopter" (rotor blades whirring) · "race_car_rev" (a race car revving) · "sailboat_flap" (a sail flapping in the wind)',
      '  GAMES/CELEBRATIONS: "ball_bounce" (a ball bouncing) · "balloon_pop" (a balloon popping) · "firework_burst" (a single gentle festive firework) · "rope_skip" (a jump rope hitting the ground) · "kite_flutter" (a kite fluttering in the wind)',
      '  PEOPLE/ACTIONS: "footsteps" (someone walking, on a normal surface) · "applause" (clapping/cheering) · "laugh" (laughter) · "splash" (something splashing into water) · "glass_clink" (glasses/cups clinking)',
      '  INSTRUMENTS/OBJECTS (a specific instrument or object is played, rung, or handled in THIS scene): "violin" (a violin is played) · "piano" (a piano is played) · "guitar" (a guitar is played/strummed) · "flute" (a flute is played) · "drum" (a drum is beaten) · "trumpet" (a trumpet is played) · "harp" (a harp is played) · "accordion" (an accordion is played) · "xylophone" (a xylophone is played) · "music_box" (a music box plays) · "tambourine" (a tambourine is shaken) · "harmonica" (a harmonica is played) · "bell_ring" (a hand bell/chime rings once) · "page_turn" (a book page turns) · "key_turn" (a key turns in a lock) · "sword_clash" (swords clash once) · "whistle" (a character whistles a tune) · "umbrella_open" (an umbrella opens) · "camera_click" (a camera shutter clicks) · "kettle_whistle" (a kettle whistles) · "cart_wheels" (a cart/wagon creaks and rolls) · "coin_clink" (coins clink) · "drawer_open" (a drawer slides open) · "zipper" (a zipper is pulled)',
      '  MOOD ACCENTS (a musical sting, not a literal sound effect): "magic_chime" (a magical sparkle moment) · "triumphant" (a victorious/joyful high point) · "tense_sting" (a sudden scare or shock) · "sad_tone" (a sorrowful, tender beat)',
      '  EMOTIONS (a character\'s own non-verbal reaction, in THIS scene — use to make feelings audible, not just narrated): "giggle" (soft happy giggling) · "cheer_yay" (a joyful group cheer) · "sigh" (a soft contented sigh) · "yawn" (a sleepy yawn) · "sneeze" (a gentle sneeze) · "hiccup" (cute hiccupping) · "hum_content" (contented humming) · "surprised_oh" (a soft gasp of pleasant surprise) · "group_aww" (a warm, endeared "aww") · "gasp_fear" (a mild fright gasp, never terrifying) · "determined_grunt" (a short effortful grunt) · "relief_exhale" (a long relieved breath) · "whisper" (a soft hushed whisper)',
      '  SLEEP: "snore" (a character audibly snoring/sleeping in THIS scene)',
      "Omit `sfx` only for the rare scene where none of these genuinely fit — never pick more than one per scene.",
      "SOUND MUST MATCH THE PICTURE: whenever you DO set `sfx`, the imagePrompt for that same scene MUST visibly show that exact sound happening — the listener hears it AND sees it. An animal `sfx` needs the animal drawn mid-sound (mouth open barking/mooing/quacking, an expressive sound-making pose) — but ALWAYS gentle and FRIENDLY, never aggressive or scary: a happy open-mouth bark with a wagging tail and soft eyes, NEVER bared teeth, a snarl, or a threatening posture, even for a big dog breed. An instrument `sfx` needs a character actively playing it (bow on the violin strings, hands on the piano keys, fingers on the guitar strings), an object or vehicle `sfx` needs the object shown mid-action (the bell mid-ring with motion lines, the key turning in the lock, the page mid-turn, the airplane visible in the sky, the ball mid-bounce), a weather or NATURE/PLACES `sfx` needs that weather or setting visibly present in the scene (rain falling, lightning flashing, leaves blown sideways in the wind, a campfire glowing, a waterfall in the background), drawn as gentle/cozy rather than dramatic, and an EMOTIONS `sfx` needs the character's face/body clearly showing that exact feeling (a wide giggling smile, a big yawn with an open mouth, arms raised mid-cheer) — never set one whose feeling isn't also visible on the character's face. Never set an `sfx` whose source is off-screen or already finished by the time of the picture.",
      "",
      "═══ OUTPUT ═══",
      "Reply with ONLY valid RFC 8259 JSON — no markdown, no code fences, no // comments, no trailing commas.",
      "Required fields per scene: index (number), narration (string), imagePrompt (string), soundscape (one of the 5 values). Optional: sfx.",
      "Compact example structure (fill in real content):",
      '{"title":"...","heroDescription":"...","worldNotes":"...","scenes":[{"index":1,"narration":"...","imagePrompt":"...","soundscape":"magic"},{"index":2,"narration":"...","imagePrompt":"...","soundscape":"night","sfx":"snore"}]}',
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
    "- VYMYŠLENÉ POSTAVY NIKDY NESDÍLÍ JMÉNO s nikým ze seznamu 'Postavy:'/'Characters:' (i kdyby ta osoba v TÉTO konkrétní pohádce nevystupovala) — rodina krtků nebo jakékoli jiné vymyšlené obsazení dostane VLASTNÍ, odlišná jména, nikdy vypůjčená z rodinné kartotéky. Použití jména člena rodiny pro nesouvisejícího vymyšleného tvora riskuje, že se ty dvě identity popletou.",
    "- SMĚR PŘIZPŮSOBENÍ (KLÍČOVÉ): proporce, velikost těla a styl kanonických hrdinů jsou PEVNÉ bez ohledu na to, kdo dalšího je ve scéně s nimi — když vymyslíš vedlejší postavy (zvířecí rodinu, tvora, dav), ony se přizpůsobí VZHLEDEM a stylem NAŠIM hrdinům a jejich světu, nikdy naopak. Hrdina se nikdy nezmenší, nezakulatí do jiného stylu ani jinak nezmění jen proto, že jsou ve stejné scéně nekanonické postavy.",
    "- Odděluj postavy pomocí ' | '",
    "- Buď maximálně konkrétní — ne 'blond hair' ale 'straight light-blond hair'; ne 'red shirt' ale 'white T-shirt with two red horizontal stripes'.",
    "- NEZAHRNUJ číselný věk ani slova o věku ('6-year-old', 'toddler') — jen vlasy, oči, oblečení, doplňky, výraz tváře.",
    "- heroDescription ZAKONČI záznamem 'Heights:' s RELATIVNÍMI výškami všech postav BEZ věkových slov, např. 'Heights: Valentýna is the smallest — the top of her head reaches Nicolas's shoulders; James is exactly the same height as Nicolas; Jana and Jan are grown-ups, much taller than all the children.' Tím zůstanou velikosti těl konzistentní na všech obrázcích.",
    "- POKUD SAMOTNÝ DĚJ zahrnuje změnu výšky/velikosti postavy v průběhu příběhu (růstový skok, kouzelné zmenšení, zranění — cokoli, co ZÁMĚRNĚ mění tělesné proporce) — NENÍ to chyba konzistence, musí se to nakreslit jako záměrná změna stavu: (1) záznam 'Heights:' popisuje jen POČÁTEČNÍ poměr (před změnou), (2) KAŽDÝ imagePrompt od scény změny dál KONČÍ výslovným přepsáním aktuálního poměru pro TU scénu, např. '(Nicolas now stands noticeably taller than James, about half a head above him)'. Scény před změnou takovou poznámku nepotřebují (platí výchozí Heights:). Proměna se nikdy nesmí projevit postupně/náhodně napříč nesouvisejícími scénami — nastane JEN v přesné scéně, kde ji způsobí děj, a všechny scény po ní zůstávají důsledně v NOVÉM stavu.",
    "- OBRAZNÝ růst NENÍ fyzický růst: fráze jako 'roste ve hvězdu/legendu/hrdinu' nebo 'roste v odvaze' popisují dovednost, slávu nebo sebevědomí, NE doslovnou změnu věku či velikosti těla — pokud děj nemá JEDNU KONKRÉTNÍ, pojmenovanou proměňující událost (konkrétní kouzelné jídlo, kouzlo, zranění), kresli postavu v kanonické dětské velikosti/věku ve VŠECH scénách, včetně úplně poslední. Nikdy nenech postavu v pozdní 'triumfální' nebo 'dospělé' scéně tiše vypadat starší nebo vyšší bez takové výslovné události.",
    "- Pokud v příběhu vystupuje OPAKUJÍCÍ SE PŘEDMĚT (auto, kterým jedou, kouzelný předmět, oblíbená hračka, nebo JAKÁKOLI všední rekvizita, kterou postava opakovaně nosí/krade/používá — košík, hrnec, lucerna, nářadí — byť malá a nenápadná), přidej do heroDescription záznam 'Key objects:' s jeho PŘESNÝM vzhledem A — pokud jich postava má víc než jeden — PŘESNÝM POČTEM ('jeden otlučený měděný hrnec' vs. 'tři nesourodé proutěné košíky'). V imagePromptech na něj odkazuj JEDNÍM krátkým stálým označením (např. 'the sky-blue pickup truck', 'the copper pot') — plný popis se do obrázkového modelu vkládá automaticky. Předmět NIKDY nemění typ, tvar, barvu ANI POČET mezi scénami — jeden hrnec se nikdy nerozmnoží na několik v jednom obrázku ani napříč scénami, stejné auto zůstává stejným autem celou pohádku.",
    "- SPORTOVNÍ VYBAVENÍ JE VŽDY KEY OBJECT: když postava jede na kole, lyžuje, plave apod., zamkni vybavení v 'Key objects:' s přesným typem a barvami (anglicky, např. 'a black triathlon time-trial bike with aero handlebars and deep black racing wheels'). Časovkářské kolo se nikdy nezmění v silniční.",
    "- Pokud děj vyžaduje JINÉ OBLEČENÍ než kanonický popis postavy (sport, zima, plavání, kostým), NEUPRAVUJ záznam postavy — přidej samostatný záznam 'Story outfits:', např. 'Story outfits: Jan wears a sleeveless navy-and-white triathlon suit with a red stripe and white cycling shoes — IDENTICAL in every scene (overrides his default clothing).' Jeden převlek na postavu pro CELÝ příběh.",
    "- LOGIKA POČASÍ A ROČNÍHO OBDOBÍ (POVINNÁ): urči roční období a podnebí podle prostředí. Pokud NENÍ mírné počasí, dej KAŽDÉ postavě počasový ŠATNÍK v záznamu 'Story outfits:' (anglicky) se DVĚMA pevnými variantami: 'outdoors: ...' (sníh/zima → teplá zimní bunda, čepice, šála, rukavice, sněhule; horké léto/pláž → lehké oblečení, sandály, při koupání plavky; déšť → pláštěnka a holínky) a 'indoors: ...' (co mají vespod — obvykle kanonické oblečení, bunda a čepice sundané). Zachovej typické barvy postav, ať zůstanou rozpoznatelné (kluk známý bílým tričkem s červenými pruhy dostane červeno-bílou pruhovanou čepici). Každá varianta je IDENTICKÁ pokaždé, když se objeví — stejná bunda v každé venkovní scéně.",
    "- KAŽDÝ imagePrompt musí KONČIT stavem oblečení TÉ scény podle místa děje: '(everyone in their outdoor winter clothes)' venku, nebo '(indoors — jackets and hats off)' uvnitř budov. VŠECHNY postavy v jedné scéně jsou oblečené pro STEJNÉ podmínky — NIKDY jedna nabalená v bundě a druhá v tričku na stejném místě. Nikdy letní oblečení ve sněhu, nikdy zimní bundy na pláži nebo uvnitř vytopené místnosti.",
    "- SKUPINOVÉ UNIFORMY (POVINNÉ, kdykoli má příběh dvě a víc SKUPIN, které by měly vypadat odlišně a vnitřně jednotně — sportovní týmy, rivalitní školy, království, cechy, kluby, party, uniformovaný personál, NEJEN doslovné sportovní zápasy): přidej do heroDescription záznam 'Team kits:', který zamkne PŘESNÝ vzhled/barvy KAŽDÉ skupiny (anglicky), např. 'Team kits: Nicolas's team wears a red shirt with white sleeves, white shorts, red socks; opponents wear light-blue-and-white striped shirts, black shorts.' nebo 'Team kits: Sunnyvale Knights wear gold-and-blue tunics; Riverbend Foxes wear green-and-grey tunics.' KAŽDÝ imagePrompt pro scénu, kde skupinová aktivita probíhá, musí KONČIT tím, kterou uniformu postava má: '(Nicolas and teammates in their team kit)', nebo '(Nicolas in his everyday clothes, off duty)', když scéna s danou aktivitou nesouvisí — nikdy míchanka uniformy a civilu mezi lidmi ve STEJNÉ skupinové scéně ve STEJNOU chvíli.",
    "- SCORE TABULE A DISPLEJE: skórovací tabule smí ukazovat POUZE skóre jako čísla (např. '2:1') — NIKDY zkratky týmů/zemí ani jiná písmena/slova na ní ani kdekoli jinde v obrázku.",
    "- Pokud jsou přiloženy referenční fotografie, popiš přesně co vidíš na fotce.",
    "- Tyto popisy se NIKDY nemění napříč scénami.",
    "- FONETICKÉ NÁPOVĚDY PRO HLAS: kdykoli VYMYSLÍŠ jméno/název (postava, místo, jídlo, předmět), jehož pravopis by mohl hlas namlouvající pohádku v jazyce narace přečíst špatně (cizokrajné hláskové kombinace, vymyšlená slova, slovní hříčky) — zakonči heroDescription jedním navíc záznamem s PŘESNĚ tímhle štítkem: 'Pronunciation hints: Written→SaysAs; Written2→SaysAs2' (páry odděl ';', šipka je opravdový znak →). SaysAs napiš tak, jak by to SPRÁVNĚ přečetl rodilý čtenář daného jazyka NAHLAS — používá se JEN pro namluvení, čtenář ho nikdy neuvidí, nemusí tedy vypadat jako skutečné slovo. Pokud žádné vymyšlené jméno nápovědu nepotřebuje, tenhle záznam úplně vynech.",
    "",
    "═══ STRUKTURA PŘÍBĚHU ═══",
    "- Scéna 1: Uveď svět a HÁČEK — tajemství, otázku nebo problém, který čtenáře okamžitě vtáhne.",
    "- Scény 2 až N-1: Stoupající děj se zvyšujícím se napětím; zahrň alespoň JEDNO nečekané překvapení (pomocník, který se ukáže být zdrojem problému, zkratka vedoucí na kouzelné místo, přítel, který všechny překvapí).",
    "- Překvapení musí být ZASLOUŽENÉ — zasej nápovědu nebo zárodek dříve v příběhu.",
    "- SKUTEČNÁ SÁZKA: v ohrožení musí být něco, na čem hrdinovi opravdu záleží (kamarád ztracený v mlze, poslední zhasínající lucernička, téměř prohraný závod) — přiměřeně věku, žádná krutost, ale nebezpečí musí být CÍTIT.",
    "- TEMNÝ OKAMŽIK: kolem 70–80 % příběhu přijde nejnižší bod — plán selže, naděje pohasíná… Nech ho chvíli DOZNÍT (jedna tichá scéna), než hrdina najde odvahu, pomoc kamaráda nebo dříve zasetou nápovědu. Rozuzlení pak působí zaslouženě a hřejivě.",
    "- Protagonista se musí do konce ZMĚNIT nebo NAUČIT něco smysluplného.",
    "- Scény by měly odkazovat na dřívější události (ohlasy): 'kouzelná houba ze scény 2 je zachrání ve scéně 6'.",
    "- KAUZÁLNÍ ŘETĚZ (KLÍČOVÉ): po sobě jdoucí scény spojuj přes „PROTO“ nebo „ALE“ — nikdy přes „a pak“. Každá scéna je DŮSLEDKEM předchozí, nebo její komplikací; scéna, kterou lze vypustit bez přetržení řetězu, do příběhu nepatří.",
    "- PRAVIDLO TŘÍ S GRADACÍ: hrdina se pokusí problém vyřešit TŘIKRÁT — 1. pokus selže málo, 2. pokus selže víc (sázky pokaždé rostou), 3. pokus uspěje JEN díky tomu, co se hrdina naučil z prvních dvou selhání. Každý pokus musí být opravdu JINÝ, ne stejná akce znovu.",
    "- SÁZKY JEN ROSTOU: každá překážka je VĚTŠÍ než ta před ní; nikdy nevyřeš problém a pak nepředlož menší. Jednou VYŘEŠENÝ problém zůstává vyřešený — potichu se nevrací.",
    "- ŽÁDNÝ DEUS EX MACHINA: vyvrcholení vyřeší HRDINA něčím, co bylo zavedeno dřív (dovednost, předmět, kamarád, ponaučení) — nikdy nová postava, nové kouzlo nebo šťastná náhoda na poslední chvíli. Po půlce příběhu už žádné nové postavy.",
    "- USPÁVACÍ ZKLIDNĚNÍ: po vyvrcholení energie scénu za scénou KLESÁ — poslední scéna je klidná, hřejivá a ospalá (domov, bezpečí, objetí, zavírání očí), ať posluchač odplouvá ke spánku.",
    "- VYHNI SE: epizodické scény, které nesouvisí; zřejmá řešení; formulové 'a žili šťastně' konce bez zasloužení.",
    "- Emoční oblouk: úžas → napětí → naděje → překvapení → zasloužené rozuzlení → zklidnění.",
    "",
    "═══ VYHNI SE OMLETÝM MOTIVŮM (DŮLEŽITÉ) ═══",
    "- Nesahej defaultně pořád po stejné hrstce berliček: kouzelný třpytivý prášek, co vyřeší cokoli, kouzelná mince/amulet/přívěsek plnící přání, ponaučení, co se scvrkne na „stačí to dělat s dobrým srdíčkem“, nebo domeček/hračka/předmět, co se nakonec ukáže mít srdce a city. Tohle je v pořádku JEN když si to vyloženě žádá uživatelovo vlastní zadání, svět nebo téma — jinak vyřeš zápletku JINÝM motorem: záhada řešená stopami a úsudkem, dovednost, kterou hrdina trénuje a zlepšuje, nedorozumění rozmotané upřímným rozhovorem, reálná překážka (počasí, vzdálenost, něco rozbitého, hádka) překonaná snahou/důvtipem/týmovou prací, soutěž, průzkum nebo objev.",
    "- SEĎ NA ŽÁNRU, KTERÝ SVĚT/TÉMA NAZNAČUJE: vybraný svět (piráti, vesmír, detektivové, dinosauři, konkrétní reálné místo, sport) nese VLASTNÍ žánrové konvence — použij je, místo abys se pořád vracel k obecné pohádkové magii bez ohledu na svět. Detektivní svět se řeší stopami a úsudkem; sportovní svět tréninkem, strategií a týmovou prací; vesmírný svět řešením problémů a odvahou; svět reálného místa/běžného života důvtipem a lidským sepětím — kouzelný předmět není povinná výbava jen proto, že je to pohádka pro děti.",
    "- STŘÍDEJ TÉMA/PONAUČENÍ NAPŘÍČ POHÁDKAMI pro stejného posluchače: laskavost je JEDNO z mnoha možných témat (odvaha, zvídavost, upřímnost, vytrvalost, přátelství, důvtip, trpělivost, odpuštění, spolupráce, zodpovědnost) — když uživatel nezadal konkrétní ponaučení, nenech každou pohádku potichu sklouznout ke stejné zprávě o „dobrém srdíčku“. Zvol téma, co sedí TÉTO zápletce a světu, ne obecný výchozí.",
    "- PŘIZPŮSOB ROZUZLENÍ VĚKOVÉMU PROFILU níže: mladší děti dobře reagují na konkrétní, jednoduchá příčinno-důsledková rozuzlení; starší děti si užijí rozuzlení postavené na důvtipu, plánování nebo opravdu zaslouženém uvědomění — ani jedno nepotřebuje kouzlo jako berličku.",
    "",
    "═══ IMAGE PROMPTS ═══",
    "- Psát ANGLICKY, max 60 slov. Drž je KRÁTKÉ — heroDescription (appearance lock) se do obrázkového modelu vkládá automaticky u každé scény, NEKOPÍRUJ sem popisy postav.",
    "- Postavy jen JMÉNEM; popiš: akci scény, pózy, výraz tváře, prostředí, náladu, osvětlení.",
    "- JEN MALÉ SKUPINKY (KLÍČOVÉ pro kvalitu obrázků): každá scéna ukazuje NEJVÝŠE 4 jmenované postavy (velké obsazení se STŘÍDÁ po menších skupinkách napříč scénami — ostatní jsou v tu chvíli prostě jinde). Jen ZÁVĚREČNÁ scéna smí mít až 6. NIKDY nepiš do imagePromptu 'everyone', 'the family', 'the friends' — vždy vyjmenuj přesná jména POUZE těch, kdo jsou vidět. Jediná výjimka je SKUPINA V POZADÍ: smíš výslovně přidat např. 'other players of both teams in the background' nebo 'a cheering crowd in the distance' — namaluje se jako malé vzdálené postavy.",
    "- VÝJIMKA PRO SETKÁNÍ z pravidla výše: pokud narace výslovně říká, že se skupina jmenovaných postav SEJDE, SHLEDÁ nebo SEJDE SE na jednom místě (ne jen 'náhodou jsou poblíž') — např. všichni dorazí domů, celá rodina si sedne k sobě, kamarádi se po čase sejdou — imagePrompt TÉ scény MUSÍ výslovně jmenovat ÚPLNĚ VŠECHNY z nich, až do 6 (stejný strop jako u závěrečné scény). Pokud by celé obsazení té chvíle přesáhlo 6, jmenuj 6 pro děj nejdůležitějších postav a zbytek přidej jako nejmenovanou skupinu v pozadí (např. 'ostatní členové rodiny v pozadí'), místo aby potichu zmizeli. Shledání, na kterém někdo chybí, působí špatně, ale stejně tak přeplněný, těžko vykreslitelný obrázek — výjimka platí jen pro scénu/scény popisující samotné setkání, ne pro každou další scénu s tou skupinou.",
    "- NARACE A OBRÁZEK MUSÍ SEDĚT: cokoli narace popisuje jako přítomné/viditelné v TÉTO scéně (zvíře, jeho mláďata, tvor, předmět), MUSÍ se objevit i v imagePromptu, i když to nemá vlastní jméno — např. když narace mluví o čuníkách čvachtajících v blátě, imagePrompt to musí říct taky ('...piglets snuffling in the mud nearby'). Nikdy nenech to, o čem posluchač zrovna slyšel, chybět na obrázku.",
    "- NIKDY nenaračuj KONKRÉTNÍ NEPŘÍTOMNOST něčeho, co obrázek nemůže zaručit: nepiš věty typu 'na obloze nesvítil ani měsíček', 'ani hvězdička nebyla vidět', 'nikde nesvítilo jediné světýlko' — obrázkový model si noční oblohu/osvětlení dokresluje sám podle vlastní atmosférické konvence a velmi pravděpodobně namaluje přesně to, o čem jsi právě řekl, že tam NENÍ, což popře text, který dítě zrovna slyšelo. Popisuj radši, co TAM JE a jak se to CÍTÍ (teplo, světlo ohýnku, blízkost), ne co konkrétně chybí. Pokud děj opravdu vyžaduje úplnou tmu/žádný měsíc jako součást zápletky, řekni to A ZÁROVEŇ přidej odpovídající zámek do imagePromptu té scény ('a moonless, pitch-black sky').",
    "- Ukonči: 'Only [jména v této scéně] present — no other people or background figures.' (nepojmenovaná zvířata/tvorové z pravidla výše nejsou 'people' a nic to nenarušuje — jen je přidej PŘED tuhle závěrečnou větu, např. '...piglets in the background. Only Nicolas and Valentýna present — no other people or background figures.')",
    "- Nepřidávej stylové pokyny (Disney/storybook styl se připojuje automaticky).",
    "- Žádné věkové číslice ani věkově specifické výrazy.",
    "",
    "═══ STORY BIBLE (worldNotes) — nastuduj svět PŘED psaním ═══",
    "Přidej pole \"worldNotes\" (ANGLICKY, max 110 slov): faktický průvodce světem TÉTO pohádky, který musí respektovat každá scéna i každý obrázek.",
    "- (1) ZÁMEK PROSTŘEDÍ: přesně popiš opakující se dějiště a drž ho konzistentní (např. 'matches take place ON a green grass football pitch with white painted lines and two goals with white nets, small stands beside it; the river is visible BEYOND the pitch — never as the playing surface'). Každá scéna, která se tam logicky odehrává, MUSÍ dějiště jmenovat ve svém imagePromptu.",
    "- (2) REÁLNÁ SPRÁVNOST: uplatni, jak činnost doopravdy vypadá a funguje (fotbalový zápas má DVA týmy ve zřetelně JINÝCH dresech, rozhodčího, protihráče NA hřišti, jeden kulatý míč; nemocnice má lékaře v pláštích…). Zápasové/soutěžní scény MUSÍ obsahovat soupeře jako skupinu v pozadí.",
    "- (3) SKUTEČNÍ LIDÉ zmínění jménem (sportovci, celebrity — např. Lionel Messi) jsou skuteční LIDÉ: dej každému plný LIDSKÝ záznam v heroDescription (vlasy, tvář, dres, postava) jako každé jiné postavě. NIKDY nekresli doslovnou hříčku ze jména — Messi je člověk, ne lev.",
    "- (4) KAMERA: střídej záběry napříč scénami jako dobrý dokument — široký ustavující záběr, akční detail, přes rameno, oslavný záběr s davem — dějiště a postavy přitom zůstávají identické.",
    "- (5) PRAVIDLA TOHOTO SVĚTA (kánon): jednou větou urči, jak funguje zvláštní prvek příběhu (co kouzlo umí a neumí, co stroj potřebuje, čemu zvíře rozumí) — a už to NIKDY neporuš. Řešení vyvrcholení se těmito pravidly musí řídit; pochází-li svět ze známé série nebo skutečného oboru, drž se věrně jeho zavedeného kánonu.",
    "",
    "═══ SOUNDSCAPE ═══",
    "Každá scéna má `soundscape` – vyberte podle nálady scény (POVINNÉ):",
    '  "magic"     — kouzla, magie, víly, zázraky, kouzelné předměty',
    '  "forest"    — příroda, les, louka, zvířata, venku, zahrada',
    '  "night"     — noc, hvězdy, měsíc, spánek, sny, večer',
    '  "adventure" — pohyb, dobrodružství, výzva, nebezpečí, záchrana',
    '  "cozy"      — domov, jídlo, objetí, bezpečí, rodina, teplo, konec pohádky',
    "",
    "═══ ZVUKOVÝ EFEKT (sfx) ═══",
    "Volitelné pole `sfx` u scény — JEDNORÁZOVÝ zvukový efekt navíc k ambientnímu soundscape, pro něco, co DĚJ TÉTO KONKRÉTNÍ scény výslovně popisuje PRÁVĚ TEĎ. Zahrnuje JAKOUKOLI scénu, kde je středem okamžiku konkrétní zvuk-tvořící předmět nebo akce — hraje se na nástroj, zazvoní zvonek, listuje se v knize, otočí se klíč v zámku, střetnou se meče, někdo si zapíská melodii — kategorie níže jsou příklady TOHOTO VZORU, ne vyčerpávající seznam situací; ale samotná HODNOTA `sfx` musí být vždy nejbližší klíč z tohoto seznamu (nikdy nevymýšlej klíč, který tam není).",
    "SFX MÁ BÝT PRAVIDLO, NE VÝJIMKA: cíl je zhruba 70-90 % scén se sfx (u typické 10scénové pohádky to je asi 7-9 scén, u delší pohádky víc, míň jen u opravdu krátké) — pohádka skoro bez sfx zní ploše a bez života. Nehledej sfx příležitosti jen ve scénách, co už máš naplánované — rovnou PIŠ scény (dějový bod, akce postavy, imagePrompt) tak, aby zvuková chvíle byla PŘIROZENOU součástí děje: postava hraje na nástroj, zvíře zareaguje, vrznou dveře, spustí se déšť, někdo se nadechne překvapením, otočí se stránka. Střídej KATEGORIE scénu od scény (zvíře, pak předmět, pak počasí, pak emoce, pak stroj…) — nedrž se pořád jen jedné nebo dvou kategorií. Pole `sfx` vynech jen u té výjimečné scény, kde se opravdu nic zvukového nehodí, a nikdy nevybírej víc než jeden na scénu:",
    '  POČASÍ/VODA: "waves" (moře naráží/šplouchá) · "water_flow" (klidná řeka, potok nebo fontánka poblíž teče/zurčí — použij TOHLE, ne "waves", pro řeky jako Vltava, potoky a fontánky) · "thunder" (hrom/blesk udeří) · "wind_gust" (poryv nebo stálý vánek větru — použij vždy, když scéna zmiňuje vítr, šumění listí ve větru, vlající vlasy/oblečení) · "rain" (padá déšť) · "snow_crunch" (kroky křupou ve sněhu)',
    '  PŘÍRODA/MÍSTA: "campfire_crackle" (praská ohníček poblíž) · "waterfall" (v dálce hučí vodopád) · "cave_drip" (v jeskyni kape voda) · "leaves_crunch" (kroky šustí napadaným podzimním listím) · "volcano_rumble" (vzdálené sopečné dunění) · "desert_wind" (suchý vítr nad pískem)',
    '  ZVÍŘATA (zvíře se v TÉTO scéně samo ozve): "cow" (bučení) · "pig" (chrochtání) · "chicken" (kdákání) · "sheep" (bečení) · "horse" (řehtání) · "duck" (kvákání) · "dog" (štěkání) · "cat" (mňoukání) · "frog" (kuňkání) · "owl" (houkání) · "rooster" (kokrhání) · "bee" (bzučení) · "rabbit" (tiché poskakování/čenichání) · "elephant" (troubení) · "bear" (jemné přátelské mručení/funění) · "mouse" (pískání) · "bird" (cvrlikání) · "squirrel" (rychlé cvakání) · "fox" (tiché zaštěknutí) · "wolf" (jemné vzdálené vytí) · "monkey" (chichotání/houkání) · "seagull" (křik racka) · "dolphin" (cvakání/pískání) · "cricket" (cvrlikání cvrčků v noci)',
    '  STROJE/DOPRAVA: "car_engine" (nastartuje/jede auto) · "train" (rachotí/houká vlak) · "boat_horn" (houkačka lodi) · "clock_tick" (tikají hodiny) · "doorbell" (zvonek/zaklepání u dveří) · "phone_ring" (zvoní telefon) · "airplane" (nad hlavou letí malé letadlo) · "bicycle_bell" (zvonek na kole) · "rocket_launch" (odstartuje hračkovská raketa) · "helicopter" (vrtule vrtulníku) · "race_car_rev" (řve motor závodního auta) · "sailboat_flap" (plachta plácá ve větru)',
    '  HRY/OSLAVY: "ball_bounce" (odráží se míč) · "balloon_pop" (praskne balónek) · "firework_burst" (jeden jemný slavnostní ohňostroj) · "rope_skip" (švihadlo dopadá na zem) · "kite_flutter" (drak se třepotá ve větru)',
    '  LIDÉ/AKCE: "footsteps" (někdo jde po normálním povrchu) · "applause" (tleskání/jásot) · "laugh" (smích) · "splash" (šplouchnutí do vody) · "glass_clink" (cinknutí sklenic/hrnků)',
    '  NÁSTROJE/PŘEDMĚTY (v TÉTO scéně se hraje na konkrétní nástroj nebo se manipuluje s předmětem): "violin" (hraje se na housle) · "piano" (hraje se na klavír) · "guitar" (hraje/brnká se na kytaru) · "flute" (hraje se na flétnu) · "drum" (bubnuje se) · "trumpet" (hraje se na trumpetu) · "harp" (hraje se na harfu) · "accordion" (hraje se na tahací harmoniku) · "xylophone" (hraje se na xylofon) · "music_box" (hraje hrací skříňka) · "tambourine" (rozeznívá se tamburína) · "harmonica" (hraje se na foukací harmoniku) · "bell_ring" (jednou zazvoní ruční zvonek/zvoneček) · "page_turn" (otočí se stránka knihy) · "key_turn" (otočí se klíč v zámku) · "sword_clash" (jednou se střetnou meče) · "whistle" (postava si zapíská melodii) · "umbrella_open" (otevře se deštník) · "camera_click" (cvakne spoušť fotoaparátu) · "kettle_whistle" (píská konvička) · "cart_wheels" (vrže/jede vozík či kára) · "coin_clink" (cinknou mince) · "drawer_open" (vysune se zásuvka) · "zipper" (zapne se zip)',
    '  NÁLADOVÉ AKCENTY (hudební akcent, ne doslovný zvuk): "magic_chime" (kouzelný jiskřivý moment) · "triumphant" (vítězný/radostný vrchol) · "tense_sting" (náhlé leknutí/napětí) · "sad_tone" (smutný, dojemný moment)',
    '  EMOCE (postava sama neverbálně reaguje v TÉTO scéně — použij, ať jsou pocity SLYŠET, ne jen popsané): "giggle" (tiché šťastné hihňání) · "cheer_yay" (radostné hurá skupinky) · "sigh" (spokojený povzdech) · "yawn" (ospalé zívnutí) · "sneeze" (jemné kýchnutí) · "hiccup" (roztomilé škytání) · "hum_content" (spokojené broukání) · "surprised_oh" (tiché nadechnutí příjemným překvapením) · "group_aww" (vřelé, dojaté "ách") · "gasp_fear" (mírné leknutí, nikdy hrůza) · "determined_grunt" (krátké odhodlané zabručení při snaze) · "relief_exhale" (dlouhý úlevný výdech) · "whisper" (tichý šepot)',
    '  SPÁNEK: "snore" (postava slyšitelně chrápe/spí v téhle scéně)',
    "Pole `sfx` vynech jen u výjimečné scény, kde se z tohoto seznamu opravdu nic nehodí — nikdy nevybírej víc než jeden na scénu.",
    "ZVUK MUSÍ SEDĚT S OBRÁZKEM: kdykoli `sfx` NASTAVÍŠ, imagePrompt téže scény MUSÍ ten přesný zvuk viditelně ukazovat — posluchač ho slyší A VIDÍ. Zvíře u `sfx` potřebuje být nakreslené PŘI zvuku (otevřená tlama při štěkání/bučení/kvákání, výrazná póza) — ale VŽDY jemně a PŘÁTELSKY, nikdy agresivně nebo strašidelně: šťastné štěknutí s otevřenou tlamou, vrtícím ocasem a měkkýma očima, NIKDY vyceněné zuby, vrčení nebo výhružná póza, ani u velkého psího plemene. Nástroj potřebuje postavu AKTIVNĚ hrající (smyčec na strunách houslí, prsty na klávesách klavíru, prsty na strunách kytary), předmět nebo vozidlo potřebuje být zachycené PŘI akci (zvoneček uprostřed zvonění s pohybovými čarami, klíč otáčející se v zámku, stránka uprostřed otáčení, letadlo viditelné na obloze, míč uprostřed odrazu), počasí nebo PŘÍRODA/MÍSTA u `sfx` potřebuje to počasí nebo prostředí viditelně být ve scéně přítomné (padající déšť, blesk, vítr čechrající listí do strany, zářící ohníček, vodopád v pozadí), nakreslené útulně, ne dramaticky, a EMOCE u `sfx` potřebují ten přesný pocit vidět i na tváři/postoji postavy (široký hihňavý úsměv, velké zívnutí s otevřenou pusou, ruce vzhůru při jásotu) — nikdy nenastavuj emoci, kterou postava zároveň nedává najevo v obrázku. Nikdy nenastavuj `sfx`, jehož zdroj je mimo záběr nebo už v obrázku dávno doznělý.",
    "",
    "═══ VÝSTUP ═══",
    "Odpověz POUZE validním RFC 8259 JSON — bez markdown, bez ``` obalení, bez // komentářů, bez trailing čárek.",
    "Povinné pole na každou scénu: index (číslo), narration (string), imagePrompt (string), soundscape (jedna z 5 hodnot). Volitelné: sfx.",
    "Příklad struktury (vyplň reálným obsahem):",
    '{"title":"...","heroDescription":"...","worldNotes":"...","scenes":[{"index":1,"narration":"...","imagePrompt":"...","soundscape":"magic"},{"index":2,"narration":"...","imagePrompt":"...","soundscape":"night","sfx":"snore"}]}',
  ].join("\n");
}

// 👶🧒👦 Věkové profily vyprávění — čtyři vývojová pásma podle zavedených
// rámců dětské literatury (leporela/picture books/early readers/middle grade):
// délka a stavba vět, slovní zásoba, únosnost napětí (temný okamžik),
// hloubka emocí, zapojení posluchače a struktura děje se liší podle věku.
// Pásmo přepisuje obecnou strukturu příběhu ze systémového promptu tam,
// kde je pro daný věk nevhodná (batole nemá temný okamžik).
function buildAgeProfile(age: number, en: boolean): string {
  const band = age <= 3 ? 0 : age <= 5 ? 1 : age <= 7 ? 2 : 3;
  const profiles = en
    ? [
        [
          `═══ AGE PROFILE: TODDLER (${age} years) — overrides the general story structure ═══`,
          "- Narration per scene: 1–3 SHORT sentences (max 8 words each), present tense, ~120–200 characters total.",
          "- Vocabulary: only concrete everyday words the child knows (home, animals, food, family). No metaphors, no abstractions.",
          "- Structure OVERRIDE: NO dark moment, NO real stakes, no twist. Use a CUMULATIVE, predictable structure: a gentle mini-task (find the teddy, say goodnight to everyone) that grows by one small step each scene and resolves warmly.",
          "- REPETITION is the engine: one refrain sentence that returns in almost every scene, so the child can predict and 'read along'.",
          "- Lots of animal sounds and onomatopoeia; one PARTICIPATION question to the listener every 2–3 scenes ('Do you see the doggy? What does it say?').",
          "- Emotions: safety, warmth, cosiness. The final scenes slow down into a sleep ritual (yawning, tucking in, goodnight).",
        ],
        [
          `═══ AGE PROFILE: PRESCHOOL (${age} years) ═══`,
          "- Narration per scene: 2–4 sentences (max ~12 words each), ~250–400 characters total.",
          "- Vocabulary: simple and concrete; 1–2 playful new words per story, meaning always obvious from context.",
          "- Structure: ONE clear problem → journey → solution. One GENTLE twist. Magical thinking welcome (talking animals, living toys).",
          "- Tension: mild and short — the dark moment is only a soft cloud (hope dips for ONE scene, a friend or an earlier clue helps immediately).",
          "- A recurring refrain or sound the child can predict is welcome. One participation question mid-story is welcome.",
          "- Emotions: name feelings simply ('Valentina was a little scared') and show coping (a deep breath, holding hands). Themes: friendship, sharing, courage in small things.",
        ],
        [
          `═══ AGE PROFILE: EARLY SCHOOL (${age} years) ═══`,
          "- Narration per scene: 3–5 sentences, varied rhythm, ~400–550 characters total.",
          "- Vocabulary: richer; 2–3 less common words per story explained by context. Humour welcome, including light wordplay.",
          "- Structure: the FULL arc from the general rules applies (real stakes, earned twist, dark moment that breathes, callbacks).",
          "- Weave in ONE small true fact of the world naturally (how a lighthouse works, why leaves fall) — curiosity is the hook.",
          "- Emotions: inner world matters — what the hero fears, hopes and decides; the hero visibly LEARNS something and uses it.",
          "- Dialogue-heavy scenes; friends cooperate and each contributes something different.",
        ],
        [
          `═══ AGE PROFILE: OLDER CHILD (${age}+ years) ═══`,
          "- Narration per scene: 4–7 sentences, layered and vivid, ~550–750 characters total.",
          "- Vocabulary: rich, with idioms and occasional irony; the narrator may wink at the reader.",
          "- Structure: full arc PLUS one extra layer — a planted setup with a later payoff, or a red herring; scene endings may be mini-cliffhangers.",
          "- Real dilemmas with trade-offs: the hero must CHOOSE between two goods (helping a friend vs. winning), and the choice has consequences.",
          "- Weave in 1–2 accurate facts (science, history, geography) that the plot actually uses.",
          "- Emotions: deeper inner monologue, mixed feelings are allowed and named; the dark moment is fully felt before the earned resolution.",
        ],
      ]
    : [
        [
          `═══ VĚKOVÝ PROFIL: BATOLE (${age} roky) — přepisuje obecnou strukturu příběhu ═══`,
          "- Vyprávění na scénu: 1–3 KRÁTKÉ věty (max 8 slov), přítomný čas, celkem ~120–200 znaků.",
          "- Slovník: jen konkrétní známá slova (domov, zvířátka, jídlo, rodina). Žádné metafory ani abstrakce.",
          "- PŘEPIS struktury: ŽÁDNÝ temný okamžik, ŽÁDNÉ skutečné sázky, žádný zvrat. KUMULATIVNÍ, předvídatelná struktura: jemný mini-úkol (najít medvídka, popřát všem dobrou noc), který každou scénu povyroste o krůček a hřejivě se vyřeší.",
          "- Motorem je OPAKOVÁNÍ: jedna návratná věta-refrén skoro v každé scéně, ať ji dítě předvídá a „čte s sebou“.",
          "- Hodně zvuků zvířat a citoslovcí; každé 2–3 scény jedna otázka POSLUCHAČOVI („Vidíš pejska? Jak dělá?“).",
          "- Emoce: bezpečí, teplo, útulnost. Závěrečné scény zpomalí do usínacího rituálu (zívání, přikrývání, dobrou noc).",
        ],
        [
          `═══ VĚKOVÝ PROFIL: ŠKOLKA (${age} let) ═══`,
          "- Vyprávění na scénu: 2–4 věty (max ~12 slov), celkem ~250–400 znaků.",
          "- Slovník: jednoduchý a konkrétní; 1–2 hravá nová slova na pohádku, význam vždy jasný z kontextu.",
          "- Struktura: JEDEN jasný problém → cesta → řešení. Jeden JEMNÝ zvrat. Kouzelné myšlení vítáno (mluvící zvířata, oživlé hračky).",
          "- Napětí: mírné a krátké — temný okamžik je jen mráček (naděje klesne na JEDNU scénu, hned pomůže kamarád nebo dřívější nápověda).",
          "- Návratný refrén nebo zvuk, který dítě předvídá, je vítaný. Jedna otázka posluchači uprostřed příběhu je vítaná.",
          "- Emoce: pocity pojmenovat jednoduše („Valentýnka se trochu bála“) a ukázat zvládnutí (nádech, držení za ruce). Témata: kamarádství, dělení se, odvaha v malém.",
        ],
        [
          `═══ VĚKOVÝ PROFIL: MALÝ ŠKOLÁK (${age} let) ═══`,
          "- Vyprávění na scénu: 3–5 vět, střídavý rytmus, celkem ~400–550 znaků.",
          "- Slovník: bohatší; 2–3 méně běžná slova na pohádku vysvětlená kontextem. Humor vítán, i drobné slovní hříčky.",
          "- Struktura: platí PLNÝ oblouk z obecných pravidel (skutečné sázky, zasloužený zvrat, temný okamžik s dozněním, ohlasy).",
          "- Přirozeně vpleť JEDNU malou pravdivou zajímavost o světě (jak funguje maják, proč padá listí) — zvědavost je háček.",
          "- Emoce: vnitřní svět je důležitý — čeho se hrdina bojí, v co doufá, jak se rozhoduje; hrdina se viditelně něco NAUČÍ a použije to.",
          "- Hodně dialogů; kamarádi spolupracují a každý přispěje něčím jiným.",
        ],
        [
          `═══ VĚKOVÝ PROFIL: VĚTŠÍ ŠKOLÁK (${age}+ let) ═══`,
          "- Vyprávění na scénu: 4–7 vět, vrstevnaté a živé, celkem ~550–750 znaků.",
          "- Slovník: bohatý, s idiomy a občasnou ironií; vypravěč smí na čtenáře mrknout.",
          "- Struktura: plný oblouk PLUS jedna vrstva navíc — zaseté vodítko s pozdějším vyplacením, nebo falešná stopa; konce scén smí být mini-cliffhangery.",
          "- Skutečná dilemata s cenou: hrdina musí VOLIT mezi dvěma dobry (pomoct kamarádovi vs. vyhrát) a volba má následky.",
          "- Vpleť 1–2 přesné zajímavosti (věda, historie, zeměpis), které děj opravdu použije.",
          "- Emoce: hlubší vnitřní monolog, smíšené pocity jsou dovolené a pojmenované; temný okamžik se plně prožije, než přijde zasloužené rozuzlení.",
        ],
      ];
  return profiles[band].join("\n");
}

function buildUserPrompt(req: StoryRequest, extras: StoryExtras = {}): string {
  const langName = storyLangName(req.language); // null → čeština
  const en = langName !== null; // testovací jazyky jedou na anglické kostře

  const allChars: Character[] = [
    ...req.characters,
    ...(extras.customCharacters || []).map((cc) => ({
      id: cc.id,
      name: cc.name,
      description: cc.description,
    })),
  ];

  // V cizojazyčném vyprávění vystupují postavy pod mezinárodní podobou jména
  const displayName = (c: { name: string; nameEn?: string }) =>
    en && c.nameEn ? c.nameEn : c.name;
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

  const ageProfile = buildAgeProfile(req.age, en);

  const lines = en
    ? [
        req.themeName ? `World / theme: ${req.themeName}` : "",
        req.themePrompt || "",
        req.topic ? `Wish / plot: ${req.topic}` : "",
        `Characters:`,
        cast,
        familyContext,
        ageProfile,
        `Number of scenes: ${req.sceneCount}`,
        `Narration language: ${langName}`,
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
        ageProfile,
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
    // 📖 Sequel to a story this app didn't originally write (received/shared
    // tale) — its cast's appearance was reconstructed from the pictures
    // (see describeStoryCast). Those looks are now CANONICAL, exactly like a
    // library character's description: copy them verbatim, invent nothing.
    if (req.previousStory.heroDescription) {
      lines.push(
        en
          ? `CANONICAL CAST FROM THE PREVIOUS TALE (reconstructed from its illustrations) — copy these appearances into heroDescription WORD FOR WORD for every character that reappears; only characters new to THIS installment get a fresh entry: ${req.previousStory.heroDescription.slice(0, 3000)}`
          : `KANONICKÉ OBSAZENÍ Z MINULÉ POHÁDKY (rekonstruováno z jejích obrázků) — tyto podoby zkopíruj do heroDescription DOSLOVA pro každou postavu, která se vrací; jen postavy NOVÉ pro tento díl dostanou čerstvý záznam: ${req.previousStory.heroDescription.slice(0, 3000)}`
      );
    }
    if (req.previousStory.worldNotes) {
      lines.push(
        en
          ? `WORLD CARRIED OVER from the previous tale — keep it consistent unless the new plot deliberately moves elsewhere: ${req.previousStory.worldNotes.slice(0, 1200)}`
          : `SVĚT PŘEVZATÝ z minulé pohádky — drž ho konzistentní, pokud nový děj záměrně nezavede jinam: ${req.previousStory.worldNotes.slice(0, 1200)}`
      );
    }
  }

  if (req.twoEndings) {
    lines.push(
      "",
      en
        ? [
            "TWO ENDINGS (interactive tale): the story has a SHARED plot and TWO different endings — the listener picks one.",
            "- 'scenes' = ONLY the shared plot, about two thirds of the requested page count. Its LAST scene builds a real dilemma, and the VERY LAST sentence of its narration is the narrator asking the listener a direct question naming BOTH paths (e.g. 'And what do you think — should they follow the firefly deeper into the woods, or run home to tell Dad?'). Nothing comes after the question.",
            '- Add THREE top-level fields: "choiceOptions": ["short label of path A (3–5 words)", "short label of path B"], "endingA": [3–4 scenes continuing path A], "endingB": [3–4 scenes continuing path B]. Every scene uses the SAME JSON structure as in scenes.',
            "- endingA and endingB have the SAME number of scenes. Both are warm, complete, satisfying story arcs — they differ in the path, never in quality. Both honour the moral if one is set.",
            "- The FIRST scene of each ending must VISUALLY show that path being chosen (its picture is used as the picker thumbnail) — two clearly different images.",
            "- All ending imagePrompts follow the SAME appearance rules as every other scene.",
          ].join("\n")
        : [
            "DVA KONCE (interaktivní pohádka): příběh má SPOLEČNÝ děj a DVA různé konce — posluchač si vybere.",
            "- 'scenes' = POUZE společný děj, asi dvě třetiny požadovaného počtu stránek. Jeho POSLEDNÍ scéna vygraduje skutečné dilema a ÚPLNĚ POSLEDNÍ věta její narration je otázka vypravěče přímo posluchači, která jmenuje OBĚ cesty (např. „A co myslíš ty — mají jít za světluškou hlouběji do lesa, nebo běžet domů za tatínkem?“). Po otázce už nic nenásleduje.",
            '- Přidej TŘI pole na nejvyšší úrovni: "choiceOptions": ["krátký popisek cesty A (3–5 slov)", "krátký popisek cesty B"], "endingA": [3–4 scény pokračující cestou A], "endingB": [3–4 scény pokračující cestou B]. Každá scéna má STEJNOU JSON strukturu jako ve scenes.',
            "- endingA a endingB mají STEJNÝ počet scén. Oba konce jsou vřelé, uzavřené a plnohodnotné příběhové oblouky — liší se cestou, nikdy kvalitou. Oba ctí ponaučení, pokud je zadané.",
            "- PRVNÍ scéna každého konce musí VIZUÁLNĚ ukazovat, že se hrdinové vydali právě touto cestou (její obrázek slouží jako náhled ve výběru) — dva zřetelně odlišné obrázky.",
            "- imagePrompty obou konců dodržují STEJNÁ pravidla vzhledu jako všechny ostatní scény.",
          ].join("\n")
    );
  }

  if (extras.pdfBriefText) {
    lines.push(
      "",
      en ? "Summary of the attached PDF (MAIN inspiration — use its places, names, dates and events):" : "Souhrn přiloženého PDF (HLAVNÍ inspirace — použij jeho místa, jména, data a události):",
      extras.pdfBriefText.slice(0, 2000)
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
    const withPhoto = extras.customCharacters.filter((c) => c.photoBase64 || c.photos?.length);
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
  // 🔀 Dva konce — nový formát: scenes = jen společný děj, endingA/endingB
  // odděleně (Claude v něm nemůže splést počítání scén). Převede se na
  // interní choice {afterScene, options, altScenes}.
  {
    const p = parsed as StoryScript & { endingA?: Scene[]; endingB?: Scene[]; choiceOptions?: [string, string] };
    const validScene = (s: Scene) => s && typeof s.narration === "string" && typeof s.imagePrompt === "string";
    if (Array.isArray(p.endingA) && Array.isArray(p.endingB) && Array.isArray(p.choiceOptions) && p.choiceOptions.length === 2) {
      const endA = p.endingA.filter(validScene);
      const endB = p.endingB.filter(validScene);
      if (endA.length >= 1 && endB.length >= 1) {
        const common = parsed.scenes.length;
        parsed.scenes = [...parsed.scenes, ...endA].map((s, i) => ({ ...s, index: i + 1 }));
        parsed.choice = {
          afterScene: common,
          options: [String(p.choiceOptions[0]), String(p.choiceOptions[1])],
          altScenes: endB,
        };
      }
      delete p.endingA;
      delete p.endingB;
      delete p.choiceOptions;
    }
  }
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

// 🎚️ "Dozor" nad zvukovým designem — JEDNO doplňkové, levné textové volání
// PO dopsání scénáře (ne jeden extra dotaz na scénu — celý scénář najednou),
// které projde soundscape/sfx všech scén a opraví jen SKUTEČNÉ problémy
// (sfx, co neodpovídá textu; stejný sfx opakovaný 3+ scény po sobě; nálada,
// co nesedí s prostředím). Nikdy netvoří nový obsah, jen upraví, co Claude
// už napsal při psaní scénáře — a nikdy nesmí generování zablokovat: chyba
// v revizi (síť, špatný JSON) = scénář jede beze změny dál (best-effort).
interface SoundFix { index: number; soundscape?: Soundscape; sfx?: SoundEffect | null; }

async function reviewSoundDesign(scenes: Scene[], language: string): Promise<void> {
  try {
    const brief = scenes.map(s => ({
      index: s.index,
      narration: s.narration.slice(0, 260),
      soundscape: s.soundscape,
      sfx: s.sfx ?? null,
    }));
    const prompt = language === "en"
      ? `You are a sound-design supervisor for a children's bedtime story app. Review each scene's 'soundscape' (background mood) and 'sfx' (one-shot effect) choices against its narration text — flag ONLY real problems: an sfx that doesn't match what the text describes, an sfx repeated in 3+ scenes in a row (should vary), a soundscape that clashes with the scene's setting/mood. Reply with ONLY a JSON array of corrections, one entry per scene that needs a fix, e.g. [{"index":1,"sfx":null},{"index":3,"soundscape":"cozy","sfx":"owl"}] — omit any field that's already fine, omit scenes needing no change entirely. Reply with [] if everything is already good.\nScenes:\n${JSON.stringify(brief)}`
      : `Jsi dozor nad zvukovým designem dětské appky na pohádky před spaním. Projdi u každé scény volbu 'soundscape' (nálada na pozadí) a 'sfx' (jednorázový efekt) proti textu narace — nahlas JEN skutečné problémy: sfx, který neodpovídá tomu, co text popisuje, sfx opakovaný 3+ scény po sobě (mělo by se to střídat), soundscape, který nesedí s prostředím/náladou scény. Odpověz POUZE JSON polem oprav, jeden záznam na scénu, co potřebuje opravit, např. [{"index":1,"sfx":null},{"index":3,"soundscape":"cozy","sfx":"owl"}] — vynech pole, co je už v pořádku, vynech scény, co žádnou opravu nepotřebují. Odpověz [], pokud je vše v pořádku.\nScény:\n${JSON.stringify(brief)}`;

    const raw = await callAnthropicApi({
      model: MODEL.trim(),
      max_tokens: 2000,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: prompt }],
    });
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end === -1) return;
    const fixes = JSON.parse(cleaned.slice(start, end + 1)) as SoundFix[];
    if (!Array.isArray(fixes)) return;
    for (const fix of fixes) {
      if (!fix || !Number.isFinite(fix.index)) continue;
      const scene = scenes.find(s => s.index === fix.index);
      if (!scene) continue;
      if (fix.soundscape) scene.soundscape = fix.soundscape;
      if ("sfx" in fix) scene.sfx = fix.sfx ?? undefined;
    }
  } catch (e) {
    console.warn("[Claude] sound-design review selhala, scénář jede beze změny:", e instanceof Error ? e.message : e);
  }
}

type AnthropicPart =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

// Strip non-printable chars from env vars — belt-and-suspenders before setting HTTP headers
function sanitizeApiKey(key: string | undefined): string {
  return (key || "").replace(/[^\x20-\x7E]/g, "").trim();
}

async function callAnthropicApi(
  body: object,
  onDelta?: (chars: number, fullText: string) => void,
  // 📋 Volitelný zápis do TRVALÉHO deníku joby (job-runner posílá logEv) —
  // dřív šly retry pokusy jen do server konzole, kterou appka/uživatel
  // nevidí, takže dlouhé „psaní… (N. pokus)" bylo bez jakéhokoli vysvětlení.
  onRetry?: (msg: string) => void
): Promise<string> {
  const apiKey = sanitizeApiKey(process.env.ANTHROPIC_API_KEY);
  if (!apiKey) throw new Error("Chybí ANTHROPIC_API_KEY.");

  // Use native fetch (Node 18+) — avoids node:https header-char validation quirks.
  // 429/529 (rate limit / overload) se zkouší znovu — fronta pohádek posílá
  // víc požadavků najednou.
  // STREAMOVÁNÍ: dlouhý scénář (dva konce ≈ 16+ scén) se nestreamovaný
  // nemusel vejít do 250s timeoutu jednoho pokusu — job pak umíral ve fázi
  // „Píšu…" a točil se dokola. Se streamem text přitéká průběžně a onDelta
  // umožňuje heartbeat (appka nehlásí falešné zaseknutí).
  //
  // ✂️ Celý pokus (spojení + čtení streamu) je teď v JEDNÉ retry smyčce —
  // dřív se opakoval jen samotný HTTP dotaz při 429/529, ale PRÁZDNÝ stream
  // (200 OK, spojení se ale přeruší uprostřed bez jediného text_delta —
  // vzácný, ale reálný zádrhel na síti/serveru) skončil rovnou fatální
  // chybou „Claude nevrátil text" bez jediného dalšího pokusu, a celá
  // příprava pohádky s tím natvrdo umřela. Teď se to (i chybové eventy ve
  // streamu) zkusí znovu, stejně jako 429/529.
  const MAX_ATTEMPTS = 3;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({ ...body, stream: true }),
        signal: AbortSignal.timeout(280_000),
      });
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      const msg = `🌐 Claude: síťová chyba, zkouším znovu (pokus ${attempt + 1}/${MAX_ATTEMPTS}): ${lastErr.message.slice(0, 140)}`;
      console.warn(msg);
      onRetry?.(msg);
      await new Promise(r => setTimeout(r, 5_000));
      continue;
    }
    if (res.status === 429 || res.status === 529) {
      await res.text().catch(() => "");
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 12_000;
      const msg = `🌐 Claude: ${res.status} (přetíženo), zkusím znovu za ${Math.round(waitMs / 1000)}s (pokus ${attempt + 1}/${MAX_ATTEMPTS})`;
      console.warn(msg);
      onRetry?.(msg);
      lastErr = new Error(`Anthropic ${res.status}`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 400)}`);
    }
    if (!res.body) { lastErr = new Error("Anthropic: empty stream"); continue; }

    // SSE: posbírat text_delta kousky; event error → zkusit znovu (ne fatálně)
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let out = "";
    let stopReason: string | undefined;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? ""; // poslední (možná neúplný) řádek nechat v bufferu
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let ev: { type?: string; delta?: { type?: string; text?: string; stop_reason?: string }; error?: { message?: string } };
          try { ev = JSON.parse(payload); } catch { continue; }
          if (ev.type === "error" || ev.error) throw new Error(`Anthropic stream error: ${ev.error?.message || "unknown"}`);
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
            out += ev.delta.text;
            onDelta?.(out.length, out);
          }
          if (ev.type === "message_delta" && ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
        }
      }
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      const msg = `🌐 Claude: chyba streamu, zkouším znovu (pokus ${attempt + 1}/${MAX_ATTEMPTS}): ${lastErr.message.slice(0, 140)}${out ? ` (mělo už ${out.length} znaků, zahazuji a jedu znovu)` : ""}`;
      console.warn(msg);
      onRetry?.(msg);
      await new Promise(r => setTimeout(r, 5_000));
      continue;
    }
    if (!out) {
      lastErr = new Error("Claude nevrátil text (prázdný stream).");
      const msg = `🌐 Claude: prázdný stream (spojení OK, ale žádný text), zkouším znovu (pokus ${attempt + 1}/${MAX_ATTEMPTS})`;
      console.warn(msg);
      onRetry?.(msg);
      await new Promise(r => setTimeout(r, 5_000));
      continue;
    }
    // ✂️ max_tokens uřízne odpověď uprostřed věty beze slova varování — dřív
    // se to nikde nekontrolovalo, appka tichý ořez prostě přijala jako hotový
    // text (viz „Enrich" u bohatého zadání, uříznuté u „A Habsburg…")
    if (stopReason === "max_tokens") console.warn(`[Claude] odpověď uřízlá limitem max_tokens (${out.length} znaků)`);
    return out;
  }
  throw lastErr || new Error("Anthropic: no response");
}

/** Vymyslí jeden hravý námět na pohádku (1–2 věty) — pro tlačítko 🎲 v UI. */
export interface TopicIdeaContext {
  /** Vybraný svět pohádky — námět se musí odehrávat v něm */
  themeName?: string;
  themePrompt?: string;
  /** Co už má uživatel napsané v poli přání — námět na tom staví */
  userHint?: string;
  /** 📍 Aktuální místo rodiny (jméno místa nebo GPS) — námět z okolí */
  locationHint?: string;
  /** 👶 Věk posluchače — bez toho appka námět netrefila tón/napětí podle věku */
  age?: number;
}

// 🎲 Náhodná "jiskra" žánru/motivu — appka měla i s pokynem "buď pokaždé
// jiný" tendenci vracet dost podobné náměty (model bez vnější náhody
// konverguje k "nejpravděpodobnějšímu" nápadu pro daný kontext). Skutečná
// náhoda (Math.random) z pestré palety donutí appku pokaždé začít odjinud.
const TOPIC_SPARKS_CS = [
  "podmořské dobrodružství", "detektivní pátrání po záhadě", "kouzelnická škola",
  "cesta do minulosti", "setkání s neobvyklým zvířetem", "závod proti času",
  "tajemný dopis/mapa", "ztracený poklad", "výlet do vesmíru", "kouzelný trh/jarmark",
  "bouřka nebo živel, co je potřeba přečkat", "nová postava, co potřebuje pomoc",
  "oslava/svátek, který se pokazí", "malé zvířátko, co se ztratilo", "kouzelný předmět s vlastní vůlí",
  "výprava do jeskyně/podzemí", "let na kouzelném koberci/balonu", "soutěž nebo hra s pravidly",
  "sen, který se zdá skutečný", "stopa vedoucí k překvapení",
];
const TOPIC_SPARKS_EN = [
  "an underwater adventure", "a detective mystery to solve", "a school of magic",
  "a journey into the past", "meeting an unusual animal", "a race against time",
  "a mysterious letter or map", "a lost treasure", "a trip into space", "a magical market/fair",
  "a storm or force of nature to weather", "a new character who needs help",
  "a celebration that goes wrong", "a lost baby animal", "a magical object with a mind of its own",
  "an expedition into a cave/underground", "flying on a magic carpet/balloon", "a game or contest with rules",
  "a dream that feels real", "a clue leading to a surprise",
];
function randomSpark(language: "cs" | "en"): string {
  const list = language === "en" ? TOPIC_SPARKS_EN : TOPIC_SPARKS_CS;
  return list[Math.floor(Math.random() * list.length)];
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
      ? ` Build on the user's notes and include them in the idea: "${ctx.userHint.slice(0, 800)}".`
      : ` Vyjdi z poznámek uživatele a zapracuj je do námětu: „${ctx.userHint.slice(0, 800)}".`
    : "";
  // 📍 Námět z místa, kde rodina právě je — skutečná krajina, moře/hory,
  // místní zvířata a poznávací prvky okolí (souřadnice Claude umí zařadit)
  const locationPart = ctx.locationHint
    ? language === "en"
      ? ` The family is RIGHT NOW at this real location: ${ctx.locationHint}. The idea MUST be set in this place or its close surroundings — use its real scenery (sea/mountains/forest/town), local animals, landmarks and atmosphere so the children recognize where they are.`
      : ` Rodina je PRÁVĚ TEĎ na tomto skutečném místě: ${ctx.locationHint}. Námět se MUSÍ odehrávat tady nebo v blízkém okolí — využij skutečnou krajinu (moře/hory/les/město), místní zvířata, poznávací místa a atmosféru, ať děti poznají, kde jsou.`
    : "";
  // 👶 Věk mění tón/napětí/slovník námětu — bez toho appka nabízela stejně
  // "dospělý" námět batoleti i staršímu školákovi.
  const agePart = ctx.age
    ? language === "en"
      ? ` Pitch it for a ${ctx.age}-year-old: match the tension, vocabulary and stakes to that age (very gentle/repetitive for a toddler, real (age-appropriate) stakes and a twist for an older child).`
      : ` Namiř to na věk ${ctx.age} let: přizpůsob napětí, slovník i sázky tomuto věku (velmi jemné a opakující se pro batole, skutečné přiměřené napětí a zvrat pro staršího školáka).`
    : "";
  // 🎲 Náhodná jiskra JEN když uživatel nemá vlastní zápisky — s hintem by
  // mohla plést, "vymysli si sám" naopak potřebuje vnější náhodu (viz TOPIC_SPARKS*).
  const sparkPart = !ctx.userHint
    ? language === "en"
      ? ` For inspiration (don't force it if it doesn't fit, just let it loosely spark the idea): ${randomSpark(language)}.`
      : ` Pro inspiraci (nemusíš to použít doslova, ať tě to jen volně navnadí): ${randomSpark(language)}.`
    : "";
  const prompt = language === "en"
    ? `Suggest ONE playful, original bedtime-story idea (1-2 sentences, max 40 words) for small children, featuring: ${who}.${worldPart}${locationPart}${hintPart}${agePart}${sparkPart} Make it concrete and magical (a place, a problem, a twist seed). Reply with ONLY the idea text — no quotes, no intro. Vary wildly every time — never repeat a setting or object you may have suggested before.`
    : `Navrhni JEDEN hravý, originální námět na pohádku před spaním (1–2 věty, max 40 slov) pro malé děti, kde vystupují: ${who}.${worldPart}${locationPart}${hintPart}${agePart}${sparkPart} Ať je konkrétní a kouzelný (místo, problém, zárodek překvapení). Odpověz POUZE textem námětu — bez uvozovek, bez úvodu. Buď pokaždé úplně jiný — nikdy neopakuj prostředí ani předmět, který jsi možná navrhl už dřív.`;
  const raw = await callAnthropicApi({
    model,
    max_tokens: 300,
    // Sonnet 5 defaultně (bez "thinking") běží ADAPTIVNÍ thinking — u
    // krátkého jednoduchého námětu jen zbytečně přidává latenci
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: prompt }],
  });
  return raw.trim().replace(/^["'„]|["'"]$/g, "");
}

/** 🪄 Rozvine stručnou kostru námětu do detailní osnovy pohádky —
 *  uživatel napíše pár slov a AI doplní postavy, místa, data, kostýmy
 *  i zápletku; výsledek se vrátí do pole přání k případné úpravě. */
export async function expandTopicIdea(
  language: "cs" | "en",
  characterNames: string[],
  ctx: TopicIdeaContext = {},
  pdfBase64?: string
): Promise<string> {
  const model = MODEL.trim();
  const who = characterNames.length ? characterNames.join(", ") : language === "en" ? "the children" : "děti";
  const worldPart = ctx.themeName
    ? language === "en"
      ? ` The story takes place in this world: ${ctx.themeName}.${ctx.themePrompt ? ` World guide: ${ctx.themePrompt.slice(0, 800)}` : ""}`
      : ` Příběh se odehrává v tomto světě: ${ctx.themeName}.${ctx.themePrompt ? ` Průvodce světem: ${ctx.themePrompt.slice(0, 800)}` : ""}`
    : "";
  // Vstupní kostra až 3000 znaků (dřív 600 — delší zadání se tiše uřízlo
  // a rozvinutí pak polovinu uživatelova textu vůbec nevidělo)
  const skeleton = (ctx.userHint || "").slice(0, 3000);
  const prompt = language === "en"
    ? [
        `The user wrote a brief skeleton of a bedtime-story idea for small children: "${skeleton}". Featured heroes: ${who}.${worldPart}`,
        "Expand it into a DETAILED story brief (6–12 sentences; up to ~280 words when the skeleton is rich). ALWAYS finish your last sentence:",
        "- Keep EVERYTHING the user specified — make it concrete and richer, never contradict it.",
        "- Add named characters, exact places, era/dates, costumes, props, and a plot with a twist seed.",
        "- If the skeleton refers to real history or legends, use faithful facts (names, dates) retold warmly for children.",
        "- Write it as a brief/outline for the storyteller, NOT as the finished tale. Reply with ONLY the brief text.",
        ...(pdfBase64
          ? ["- The attached PDF is the MAIN source: pull concrete places, names, dates, itinerary and highlights from it and build the outline on them."]
          : []),
      ].join("\n")
    : [
        `Uživatel napsal stručnou kostru námětu pohádky pro malé děti: „${skeleton}“. Vystupují: ${who}.${worldPart}`,
        "Rozviň ji do DETAILNÍ osnovy (6–12 vět; u bohaté kostry až ~280 slov). Poslední větu VŽDY dokonči:",
        "- Zachovej VŠECHNO, co uživatel zadal — jen to zkonkretizuj a obohať, nikdy nepopírej.",
        "- Doplň pojmenované postavy, přesná místa, dobu/letopočty, kostýmy, rekvizity a zápletku se zárodkem zvratu.",
        "- Pokud kostra odkazuje na skutečnou historii či legendy, použij věrná fakta (jména, data) laskavě převyprávěná pro děti.",
        "- Piš jako zadání pro vypravěče (osnovu), NE jako hotový příběh. Odpověz POUZE textem osnovy.",
        ...(pdfBase64
          ? ["- Přiložené PDF je HLAVNÍ zdroj: vytáhni z něj konkrétní místa, jména, data, program a zajímavosti a postav na nich osnovu."]
          : []),
      ].join("\n");
  const content: string | AnthropicPart[] = pdfBase64
    ? [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
        { type: "text", text: prompt },
      ]
    : prompt;
  const raw = await callAnthropicApi({
    model,
    // Strop je jen pojistka — délku řídí instrukce; ale bohaté zadání
    // (víc míst/postav/epoch, např. „10 chorvatských ostrovů v čase")
    // umí instrukci „~280 slov" přehlušit a 2000 uřízlo osnovu uprostřed
    // věty („…Habsburg") — 4096 dává reálný prostor i tomuhle případu
    max_tokens: 4096,
    thinking: { type: "disabled" },
    messages: [{ role: "user", content }],
  });
  return raw.trim();
}

/** 🌐 Překlad zadání pohádky do jazyka vybraného vypravěče (cs↔en). */
export async function translateTopicText(target: "cs" | "en", text: string): Promise<string> {
  const model = MODEL.trim();
  const prompt = target === "en"
    ? `Translate the following fairy-tale brief into natural English. Keep person names (Nicolásek, Valentýnka, Archie…) unchanged. Reply with ONLY the translation:\n\n${text.slice(0, 4000)}`
    : `Přelož následující zadání pohádky do přirozené češtiny. Jména osob nech beze změny. Odpověz POUZE překladem:\n\n${text.slice(0, 4000)}`;
  const raw = await callAnthropicApi({
    model,
    max_tokens: 4096,
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: prompt }],
  });
  return raw.trim();
}

/** 📄 Jednorázový souhrn PDF pro vypravěče — psaní pohádky pak nečte celé
 *  PDF (velký dokument se do časového limitu psaní nevešel a job umíral). */
export async function extractPdfBrief(language: "cs" | "en", pdfBase64: string): Promise<string> {
  const model = MODEL.trim();
  const prompt = language === "en"
    ? "Extract a storyteller brief from the attached PDF (max 250 words): concrete places, people/names, dates, itinerary/program, and fun curiosities usable in a children's tale. Reply with ONLY the brief text."
    : "Vytáhni z přiloženého PDF podklad pro vypravěče (max 250 slov): konkrétní místa, osoby/jména, data, itinerář/program a zajímavosti použitelné v dětské pohádce. Odpověz POUZE textem podkladu.";
  const raw = await callAnthropicApi({
    model,
    max_tokens: 800,
    thinking: { type: "disabled" },
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
        { type: "text", text: prompt },
      ],
    }],
  });
  return raw.trim();
}

// Nastudování vlastního světa: z popisu uživatele (a textu stažených odkazů)
// sestaví průvodce světem ve stylu THEMES promptů (anglicky, s CHARACTER
// REFERENCE). Když chybí podstatná informace, vrátí i JEDNU doplňující otázku.
export async function studyWorld(
  language: "cs" | "en",
  name: string,
  description: string,
  urlTexts: string[],
  // 📸 Fotky skutečného místa/postav/loga (až 5) — appka je teď posílá
  // Claudovi jako OBRÁZKY (ne jen textový popis), ať si svět skutečně
  // PROHLÉDNE, místo aby si vzhled jen domýšlel z textu — na výslovné přání
  // "ať je svět co nejvěrnější". Bez fotek se chová přesně jako dřív.
  photos: Array<{ data: string; mimeType: string }> = []
): Promise<{ prompt: string; question: string | null }> {
  const model = MODEL.trim();
  const sources = urlTexts.filter(Boolean).map((t, i) => `WEB SOURCE ${i + 1}:\n${t.slice(0, 2500)}`).join("\n\n");
  const langName = language === "en" ? "ENGLISH" : "CZECH";
  const promptText = [
    `You are defining a fairy-tale "world" for a children's story generator. The user wants their stories to take place in this world.`,
    `USER'S WORLD NAME: ${name || "(none)"}`,
    `USER'S DESCRIPTION: ${description.slice(0, 1500)}`,
    sources ? `FETCHED WEB CONTENT the user linked to:\n${sources}` : "",
    photos.length
      ? `The user also attached ${photos.length} reference photo(s) of this real place/thing/characters — look at them CAREFULLY and describe what you actually SEE (real colors, architecture/decor, layout, logos, distinguishing features, any visible people or mascots) so the guide is as FAITHFUL to the real subject as possible, not a generic guess.`
      : "",
    `FIDELITY MATTERS: prefer concrete, specific, VERIFIABLE details from the description/web content/photos over vague generic scene-setting — the goal is a guide that captures the REAL place/story/brand, not an approximation that could describe anything.`,
    ``,
    // ✍️ Tohle pole čte a upravuje přímo UŽIVATEL v editovatelném poli (na
    // rozdíl od heroDescription/imagePrompt, které appka nikdy neukazuje) —
    // musí být v jazyce appky, jinak čech vidí anglický text ve svém popisu.
    `Write a world guide the story generator will follow, in ${langName} (the user reads and edits this text directly — it must be in ${langName}, NOT English unless ${langName} is English). Format it like this:`,
    `1) One sentence: "Set the story in the world of X: ..." (setting, era, mood).`,
    `2) If the world has well-known characters (from the description, web content, photos, or your own knowledge of this fairy tale/show/book), add "CHARACTER REFERENCE:" (translate this label too) with each character's EXACT visual look (colors, clothing, size), separated by " | ".`,
    `3) One sentence about atmosphere/tone (gentle, adventurous...).`,
    `Max 180 words total. Recognize the fairy tale/show/book/brand if you know it and use your knowledge of it.`,
    ``,
    language === "en"
      ? `If an essential detail is missing or ambiguous (which characters matter, what the world looks like), also ask ONE short clarifying question in ENGLISH — the user will answer and re-run. Otherwise question is null.`
      : `Pokud chybí podstatný detail nebo je popis nejednoznačný (které postavy jsou důležité, jak svět vypadá), polož navíc JEDNU krátkou doplňující otázku ČESKY — uživatel odpoví a nechá svět nastudovat znovu. Jinak je question null.`,
    ``,
    `Reply with ONLY valid JSON: {"prompt":"...","question":"..." or null}`,
  ].filter(Boolean).join("\n");
  const parts: AnthropicPart[] = [];
  for (const ph of photos.slice(0, 5)) {
    parts.push({ type: "image", source: { type: "base64", media_type: ph.mimeType, data: ph.data } });
  }
  parts.push({ type: "text", text: promptText });
  const content: string | AnthropicPart[] = parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts;
  const raw = await callAnthropicApi({
    model,
    max_tokens: 1000,
    thinking: { type: "disabled" },
    messages: [{ role: "user", content }],
  });
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude nevrátil JSON.");
  const parsed = JSON.parse(jsonMatch[0]) as { prompt?: string; question?: string | null };
  if (!parsed.prompt) throw new Error("Claude nevrátil popis světa.");
  return { prompt: parsed.prompt, question: parsed.question || null };
}

export async function generateStory(
  req: StoryRequest,
  extras: StoryExtras = {},
  onDelta?: (chars: number, fullText: string) => void,
  // Navázání po restartu funkce: rozepsaný text z minulého běhu se pošle
  // jako prefill asistentovy odpovědi — Claude POKRAČUJE, nepíše od nuly.
  resumeText?: string,
  // 📋 Zápis do trvalého deníku joby — ať jsou retry pokusy Clauda (síťová
  // chyba, přetížení, prázdný stream) vidět appce/uživateli, ne jen v
  // server konzoli
  onLog?: (msg: string) => void
): Promise<StoryScript> {
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
    if (cc.photos?.length) {
      for (const ph of cc.photos.slice(0, 5)) {
        parts.push({
          type: "image",
          source: { type: "base64", media_type: ph.mimeType, data: ph.data },
        });
      }
    } else if (cc.photoBase64 && cc.photoMimeType) {
      parts.push({
        type: "image",
        source: { type: "base64", media_type: cc.photoMimeType, data: cc.photoBase64 },
      });
    }
  }

  parts.push({ type: "text", text: buildUserPrompt(req, extras) });

  const content: string | AnthropicPart[] =
    parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts;

  const language = req.language || "cs";

  for (let attempt = 1; attempt <= 3; attempt++) {
    // Navázání rozepsaného textu: jen v 1. pokusu — když navázaný text nejde
    // zparsovat, 2. pokus píše celý příběh od začátku. POZOR: modely Claude 5
    // NEPODPORUJÍ assistant prefill (Anthropic 400) — pokračuje se proto
    // instrukcí v user zprávě a překryv se ořízne při slepování.
    const prefix = attempt === 1 && resumeText ? resumeText.replace(/\s+$/, "") : "";
    const baseParts: AnthropicPart[] = Array.isArray(content) ? [...content] : [{ type: "text", text: content }];
    if (prefix) {
      baseParts.push({
        type: "text",
        text: `\n\n⚠ CONTINUATION MODE: You already wrote the BEGINNING of your JSON response (it was interrupted). It is quoted below between the markers. Continue EXACTLY where it stops — output ONLY the remaining characters of the SAME JSON document. Do NOT repeat anything already written, do NOT restart, no code fences, no commentary.\n<already_written>\n${prefix}\n</already_written>`,
      });
    }
    const messages: Array<{ role: string; content: string | AnthropicPart[] }> =
      [{ role: "user", content: prefix ? baseParts : content }];
    const continuation = await callAnthropicApi({
      model,
      max_tokens: 16384, // 20 scén s vyprávěním a popisy obrázků se do 8k nevešlo
      // ⏱ Sonnet 5 bez explicitního "thinking" tiše běží ADAPTIVNÍ thinking
      // (tichá změna oproti Sonnet 4.6, kde bez něj thinking neběžel vůbec) —
      // appka navíc thinking_delta eventy ve streamu vůbec nezpracovává, takže
      // se to dřív projevovalo jako neviditelný „mrtvý" čas (klidně 100+ s bez
      // jediného znaku) předtím, než začal přitékat viditelný text.
      thinking: { type: "disabled" },
      // Prompt caching: velký systémový prompt (~4k tokenů) je neměnný —
      // opakovaná čtení (fronta pohádek, restarty, navázání) stojí ~1/10.
      // Menší prompty (náměty, překlad) jsou pod kešovatelným minimem.
      system: [{ type: "text", text: buildSystemPrompt(language), cache_control: { type: "ephemeral" } }],
      messages,
    }, prefix
      ? (chars, fullText) => onDelta?.(prefix.length + chars, prefix + fullText)
      : onDelta, onLog);
    const raw = prefix ? mergeContinuation(prefix, continuation) : continuation;
    try {
      const script = parseScript(raw);
      // PRAVIDLO KONZISTENCE #1: vzhled známých postav je KANONICKÝ — vždy
      // doslova z reference/characters.json, ať Claude napsal cokoliv.
      // (Řeší „jednou blond, podruhé hnědé vlasy" mezi pohádkami.)
      script.heroDescription = enforceCanonicalAppearance(script.heroDescription || "", req, extras);
      // 📖 Story Bible: zámek prostředí a reálií se PŘIPOJÍ k heroDescription —
      // poteče tak automaticky do zámku vzhledu, archů i kontroly každého obrázku
      if (script.worldNotes && typeof script.worldNotes === "string") {
        script.heroDescription = `${script.heroDescription} | World & setting lock: ${script.worldNotes.slice(0, 700)}`;
      }
      // 🎚️ Dozor nad zvukovým designem — best-effort, nikdy neblokuje vrácení
      // scénáře (viz komentář u reviewSoundDesign výš).
      await reviewSoundDesign(
        script.choice ? [...script.scenes, ...script.choice.altScenes] : script.scenes,
        language
      );
      return script;
    } catch (e) {
      if (attempt === 3) throw e;
      const msg = `📄 Claude: scénář se nedal přečíst (JSON), zkouším ještě jednou celý od začátku (${attempt}/3): ${e instanceof Error ? e.message.slice(0, 140) : e}`;
      console.warn(msg);
      onLog?.(msg);
    }
  }
  throw new Error("Nepodařilo se vygenerovat příběh.");
}

/** Slepení navázaného psaní: model občas zopakuje pár znaků/celý ocas
 *  rozepsaného textu nebo začne code fencem — překryv se najde a ořízne. */
function mergeContinuation(prefix: string, continuation: string): string {
  let cont = continuation.replace(/^```(?:json)?\s*/i, "").replace(/^\s+/, "");
  // největší překryv: konec prefixu == začátek pokračování (až 400 znaků)
  const max = Math.min(400, prefix.length, cont.length);
  for (let len = max; len >= 8; len--) {
    if (prefix.endsWith(cont.slice(0, len))) {
      cont = cont.slice(len);
      break;
    }
  }
  // model přes zákaz zopakoval CELÝ dokument od začátku → vzít jeho verzi
  if (cont.trimStart().startsWith("{\"title\"") || cont.trimStart().startsWith("{ \"title\"")) {
    return cont;
  }
  return prefix + cont;
}

// Přestaví heroDescription: popisy postav z kartotéky se přebírají DOSLOVA.
// VŠECHNO OSTATNÍ od Clauda ZŮSTÁVÁ — záznamy postav vymyšlených příběhem
// (Otesánek, drak…), vlastních postav, 'Key objects:', 'Story outfits:'
// i 'Heights:'. (Dřívější verze cizí záznamy vyhazovala → vymyšlené postavy
// neměly zámek vzhledu a na každé scéně vypadaly jinak.)
/** ⚡ Náhled rozepsaného scénáře pro kreslení BĚHEM psaní: jakmile stream
 *  obsahuje heroDescription a KOMPLETNÍ 1. scénu (soundscape za imagePromptem
 *  = řetězce jsou uzavřené), může se scéna 1 začít malovat souběžně s psaním.
 *  Pole jdou v pořadí title → heroDescription → scenes, takže první výskyty
 *  narration/imagePrompt patří vždy scéně 1. */
export function peekEarlyScene(partial: string): { heroDescription: string; scene: Scene } | null {
  try {
    const hd = /"heroDescription"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(partial);
    const wn = /"worldNotes"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(partial);
    const na = /"narration"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(partial);
    const ip = /"imagePrompt"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(partial);
    const sc = /"soundscape"\s*:/.exec(partial);
    if (!hd || !na || !ip || !sc) return null;
    const un = (s: string) => JSON.parse(`"${s}"`) as string;
    let heroDescription = un(hd[1]);
    // 📖 Story Bible poteče i do ranného kreslení scény 1
    if (wn) heroDescription = `${heroDescription} | World & setting lock: ${un(wn[1]).slice(0, 700)}`;
    const narration = un(na[1]);
    const imagePrompt = un(ip[1]);
    if (!heroDescription || !narration || !imagePrompt) return null;
    return { heroDescription, scene: { index: 1, narration, imagePrompt } };
  } catch {
    return null;
  }
}

// ── Kanonické výšky knihovních postav — FIXNÍ, napříč VŠEMI pohádkami
// stejné. Dřív si tuhle větu Claude vymýšlel nanovo v každé pohádce jen
// podle volného příkladu v systémovém promptu — obvykle se trefil, ale
// příležitostně ne (Valentýnka „vyrostla", Nicolásek jednou stejně vysoký
// jako James, jindy ne). Když je v obsazení 1+ sledovaná postava, tahle
// věta PŘEPÍŠE, co si Claude napsal sám — jde i do vizuální kontroly
// obrázku, takže i případnou chybu modelu při kreslení appka pozná a
// nechá scénu předělat.
// Dospělí i Nicolásek mají SKUTEČNÉ cm (reálná fakta rodiny); zbytek dětí
// nemá přesné cm, jen ověřený vztah k jinému dítěti (mění se, jen když
// rodina naměří nové skutečné číslo — neodhaduj/nedopočítávej sám).
const CANONICAL_HEIGHT_CM: Record<string, number> = {
  nicolas: 111,
  jan: 185,
  jana: 172,
  eva: 173,
  jakob: 182,
};

function canonicalHeightsEntry(characters: Character[]): string | null {
  const ids = new Set(characters.map(c => c.id));
  const name = (id: string): string => {
    const c = characters.find(x => x.id === id);
    return c ? (c.nameEn || c.name) : id;
  };
  const bits: string[] = [];

  // Nicolásek: přesná výška; o něco menší než James (dřív mylně "stejně vysocí")
  if (ids.has("nicolas")) {
    bits.push(`${name("nicolas")} is 111 cm tall`);
    if (ids.has("james")) {
      bits.push(`${name("james")} is a little taller than ${name("nicolas")} — the top of ${name("nicolas")}'s head reaches only to ${name("james")}'s ears`);
    }
  }

  // Valentýnka: nejmenší dítě, po uši Nicoláska (opraveno z dřívějšího "po bradu")
  if (ids.has("valentyna") && ids.has("nicolas")) {
    bits.push(`${name("valentyna")} is the smallest — the top of her head reaches only to ${name("nicolas")}'s ears`);
  }

  // Bella: o půl hlavy vyšší než James a Nicolásek (beze změny)
  if (ids.has("bella")) {
    const anchors = ["james", "nicolas"].filter(id => ids.has(id)).map(name);
    if (anchors.length) bits.push(`${name("bella")} is about half a head taller than ${anchors.join(" and ")}`);
  }

  // Dospělí: přesné cm
  for (const id of ["jan", "jana", "eva", "jakob"] as const) {
    if (ids.has(id)) bits.push(`${name(id)} is ${CANONICAL_HEIGHT_CM[id]} cm tall`);
  }
  const anyAdult = ["jan", "jana", "eva", "jakob"].some(id => ids.has(id));
  const anyChild = ["nicolas", "valentyna", "james", "bella"].some(id => ids.has(id));
  if (anyAdult && anyChild) bits.push("all the adults are much taller than the children");

  if (bits.length === 0) return null;
  return `Heights: ${bits.join("; ")}.`;
}

export function enforceCanonicalAppearance(hero: string, req: StoryRequest, extras: StoryExtras = {}): string {
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
  // Fixní věta o výškách (jen pokud jsou v obsazení 2+ sledované postavy) —
  // Claudovu vlastní "Heights:" větu zahodit JEN tehdy, když ji máme čím
  // nahradit; jinak zůstává jeho volná verze (např. čistě vymyšlené obsazení)
  const canonicalHeights = canonicalHeightsEntry(req.characters);
  // 🩺 canonicalHeightsEntry zná jen FIXNÍ knihovní postavy (Nicolásek,
  // James, Valentýnka, Bella, dospělí) — dřív se jí ale úplně NAHRADILA
  // Claudova VLASTNÍ Heights: věta, i když ta navíc obsahovala výšku
  // VYMYŠLENÉ/vlastní postavy (např. "Vaja: o kousek menší než Nicolásek").
  // Ta informace tak zmizela úplně a model si vzájemnou velikost dvou dětí
  // musel po scénách "domýšlet" sám — proto viditelný drift (jednou 2× větší,
  // pak skoro stejně velcí). Teď se Claudova vlastní věta zachová a fixní
  // knihovní fakta se k ní jen PŘIDAJÍ (ne nahradí), ať zůstane i vztah k
  // libovolné vymyšlené postavě, kterou zná jen Claude, ne tahle tabulka.
  const ownHeights = parts.find(p => /^heights\s*:/i.test(p));
  const mergedHeights = canonicalHeights && ownHeights
    ? `${canonicalHeights} ${ownHeights.replace(/^heights\s*:\s*/i, "").trim()}`
    : canonicalHeights || ownHeights || null;
  // Claudovy verze kanonických postav pryč (nahradí je doslovná kartotéka),
  // vše ostatní v původním pořadí zůstává
  const kept = parts.filter(p => !isCanonEntry(p) && !/^heights\s*:/i.test(p));
  const canonical = req.characters.map(c => c.description).filter(Boolean);
  // Vlastní postava bez záznamu → doplnit z jejího popisu
  for (const cc of extras.customCharacters || []) {
    const has = kept.some(p => p.toLowerCase().startsWith(cc.name.toLowerCase() + ":"));
    if (!has && cc.description) kept.push(`${cc.name}: ${cc.description}`);
  }
  const finalParts = [...canonical, ...kept];
  if (mergedHeights) finalParts.push(mergedHeights);
  return finalParts.join(" | ");
}

// Sekce v heroDescription, které NEJSOU jména postav (aby je invented-jméno
// parser nebral omylem jako vymyšlenou postavu)
const HERO_DESC_NON_CHARACTER_SECTIONS = new Set(["heights", "key objects", "story outfits", "world & setting lock", "world and setting lock", "pronunciation hints"]);

/** 🕵️ Jména postav VYMYŠLENÝCH pro tuhle konkrétní pohádku (ne z kartotéky) —
 *  ty NEMAJÍ malovaný referenční portrét, takže bez obrázkové kotvy jejich
 *  vzhled mezi scénami „plave" (viz „Bora" — jednou elf, jednou kočkovitá
 *  příšera, jednou skřítek). Používá job-runner k tomu, aby si po PRVNÍM
 *  úspěšném nakreslení takové postavy uložil obrázek jako její vlastní kotvu
 *  pro všechny další scény, kde se jmenovitě objeví. */
export function inventedCharacterNames(heroDescription: string, req: StoryRequest, extras: StoryExtras = {}): string[] {
  const canonNames = new Set<string>();
  for (const c of req.characters) {
    if (c.name) canonNames.add(c.name.toLowerCase());
    if (c.nameEn) canonNames.add(c.nameEn.toLowerCase());
  }
  for (const cc of extras.customCharacters || []) {
    if (cc.name) canonNames.add(cc.name.toLowerCase());
  }
  const names: string[] = [];
  for (const p of heroDescription.split("|").map(s => s.trim()).filter(Boolean)) {
    const name = p.split(":")[0]?.trim();
    if (!name || name.length > 40) continue;
    const low = name.toLowerCase();
    if (HERO_DESC_NON_CHARACTER_SECTIONS.has(low) || canonNames.has(low)) continue;
    names.push(name);
  }
  return names;
}
