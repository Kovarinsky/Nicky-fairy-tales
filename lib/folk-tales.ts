// Licenčně volné klasické pohádky — texty jsou public domain (lidová tvorba,
// K. J. Erben †1870, B. Němcová †1862, bratři Grimmové †1859/1863,
// H. Ch. Andersen †1875, Ch. Perrault †1703). Pozor: volný je PŘÍBĚH, ne
// konkrétní filmové/TV podoby (např. Popelka 1973) — prompty proto popisují
// jen lidový děj, vizuál si maluje Gemini po svém.
// Vybraná pohádka se chová jako „vlastní svět": příběh se odehrává v jejím
// ději spolu se zaškrtnutými rodinnými hrdiny.

export interface FolkTale {
  id: string;
  name: string;    // cs
  nameEn: string;
  emoji: string;
  prompt: string;  // průvodce světem pro Clauda (děj jako inspirace)
}

export const FOLK_TALES: FolkTale[] = [
  { id: "folk_karkulka", name: "Červená Karkulka", nameEn: "Little Red Riding Hood", emoji: "🧢",
    prompt: "Classic folk tale 'Little Red Riding Hood' (Červená Karkulka): a child in a red hood carries a basket through the forest to grandma's cottage and meets a sly (but not scary) wolf. Retell gently: the wolf is outsmarted, nobody gets hurt. Forest path, flowers, grandma's cottage." },
  { id: "folk_chaloupka", name: "Perníková chaloupka", nameEn: "Hansel and Gretel", emoji: "🍭",
    prompt: "Classic folk tale 'Hansel and Gretel' (Perníková chaloupka): two children find a cottage made of gingerbread and sweets deep in the forest; its grumpy old owner is outwitted and the children find their way home. Gentle retelling, no cruelty. Candy cottage details, night forest, breadcrumb trail." },
  { id: "folk_popelka", name: "O Popelce", nameEn: "Cinderella", emoji: "👠",
    prompt: "Classic folk tale 'Cinderella' (Popelka): a kind hardworking girl, three magic hazelnuts with beautiful dresses, a royal ball and a lost slipper that reveals her. Folk Czech version with the hazelnut twig, kind animals helping with chores. Castle ball, winter countryside." },
  { id: "folk_ruzenka", name: "Šípková Růženka", nameEn: "Sleeping Beauty", emoji: "🌹",
    prompt: "Classic folk tale 'Sleeping Beauty' (Šípková Růženka): a princess pricks her finger on a spindle and the whole castle falls asleep behind a hedge of wild roses for a hundred years, until a kind visitor wakes it. Overgrown rose hedge, sleeping castle, gentle awakening." },
  { id: "folk_snehurka", name: "Sněhurka a sedm trpaslíků", nameEn: "Snow White", emoji: "🍎",
    prompt: "Classic folk tale 'Snow White' (Sněhurka): a kind girl finds refuge in a tiny forest cottage of seven friendly dwarfs; a vain queen with a magic mirror and an apple causes a deep sleep, broken by friendship and love. Gentle retelling. Dwarf cottage, forest animals, sparkling mine." },
  { id: "folk_zlatovlaska", name: "Zlatovláska (Erben)", nameEn: "Goldilocks (Erben)", emoji: "👑",
    prompt: "Czech classic 'Zlatovláska' by K. J. Erben: Jiřík eats a bite of magic snake and understands animal speech; he helps ants, ravens and a golden fish, and they help him win golden-haired princess Zlatovláska. Talking animals repay kindness. Royal castle, sea, golden hair glow." },
  { id: "folk_dlouhy", name: "Dlouhý, Široký a Bystrozraký", nameEn: "Long, Broad and Sharpsight", emoji: "👁️",
    prompt: "Czech classic 'Dlouhý, Široký a Bystrozraký' by K. J. Erben: a prince and three friends with magic gifts — one stretches tall as a tower, one grows wide as a mountain, one sees through everything — outwit a grumpy sorcerer and free a princess. Teamwork of funny giants, iron castle." },
  { id: "folk_vsevedy", name: "Tři zlaté vlasy děda Vševěda", nameEn: "Three Golden Hairs of Grandfather Know-All", emoji: "🌞",
    prompt: "Czech classic 'Tři zlaté vlasy děda Vševěda' by K. J. Erben: brave Plaváček journeys to the sun-grandfather Vševěd for three golden hairs, answering riddles for people along the way (a dry pear tree, a well, a ferryman). Journey tale full of kindness and clever answers. Golden sun palace." },
  { id: "folk_smolicek", name: "O Smolíčkovi", nameEn: "Smolíček and the Golden Deer", emoji: "🦌",
    prompt: "Czech classic 'O Smolíčkovi': little Smolíček lives with a golden-antlered deer (jelen se zlatými parohy); sneaky jeskyňky trick him into opening the door, but the faithful deer rescues him on its back. Gentle retelling. Forest cottage, golden antlers shining." },
  { id: "folk_budulinek", name: "Budulínek", nameEn: "Budulínek", emoji: "🦊",
    prompt: "Czech classic 'Budulínek': a small boy home alone opens the door to a clever fox despite grandparents' warning and rides off to the fox den; grandpa and grandma get him back with music (a fiddle). Gentle humor, no one hurt. Cottage, fox den with little foxes, peas porridge." },
  { id: "folk_kobli", name: "O Koblížkovi", nameEn: "The Runaway Pancake", emoji: "🥞",
    prompt: "Czech classic 'O Koblížkovi': a round doughnut rolls off the windowsill and merrily escapes grandma, grandpa, a hare, a wolf and a bear, singing his cheeky song — until a sly fox almost tricks him (in our gentle version he rolls happily home). Rolling chase through meadows." },
  { id: "folk_repa", name: "O veliké řepě", nameEn: "The Giant Turnip", emoji: "🥕",
    prompt: "Classic folk tale 'The Giant Turnip' (O veliké řepě): a turnip grows so huge that grandpa, grandma, kids, dog, cat and finally a tiny mouse must ALL pull together to get it out. Everyone counts, even the smallest. Village garden, funny tug-of-war line." },
  { id: "folk_hrnecek", name: "Hrnečku, vař!", nameEn: "The Magic Porridge Pot", emoji: "🍲",
    prompt: "Czech classic 'Hrnečku, vař!' (K. J. Erben): a poor girl receives a magic pot that cooks sweet porridge on command — but mother forgets the stopping words and porridge floods the whole village until the girl returns. Gentle humor, porridge everywhere. Village cottages in waves of porridge." },
  { id: "folk_mesicky", name: "O dvanácti měsíčkách", nameEn: "The Twelve Months", emoji: "❄️",
    prompt: "Czech classic 'O dvanácti měsíčkách' by Božena Němcová: kind Maruška is sent into winter mountains for violets, strawberries and apples; around a magic fire she meets the twelve Months who take turns ruling the year and help her kindness. Snowy mountains, magic bonfire, seasons changing in a circle." },
  { id: "folk_kaca", name: "Čert a Káča", nameEn: "Kate and the Devil", emoji: "😈",
    prompt: "Czech classic 'Čert a Káča' (Božena Němcová): chatty Káča dances with a shy little devil who cannot get rid of her — she holds on all the way to the devils' mill, and a clever shepherd sorts it all out. Comical, devils are silly not scary. Village dance, funny devil mill." },
  { id: "folk_otesanek", name: "Otesánek", nameEn: "Otesánek the Eater", emoji: "🪵",
    prompt: "Czech classic 'Otesánek' (K. J. Erben): a childless couple carves a baby from a tree stump — it comes alive with a huge appetite and eats everything in sight, growing bigger and bigger, until a clever grandma with a hoe frees everyone. Gentle comic retelling, everything eaten pops back out. Village, giant wooden baby." },
  { id: "folk_sul", name: "Sůl nad zlato", nameEn: "Salt over Gold", emoji: "🧂",
    prompt: "Czech classic 'Sůl nad zlato' (Božena Němcová): a princess tells her father the king she loves him like salt — he banishes her in anger, until the kingdom loses all salt and learns that plain salt is more precious than gold. Castle, feast without salt, wise old herb woman." },
  { id: "folk_honza", name: "O hloupém Honzovi", nameEn: "Simple Honza", emoji: "🥨",
    prompt: "Czech classic 'O hloupém Honzovi': good-hearted Honza sets out into the world with a bag of buchty (sweet buns) from mom; his simple kindness and luck outdo all the clever ones and he wins half a kingdom. Cheerful village-boy humor, dusty road, castle at the end." },
  { id: "folk_palecek", name: "O Palečkovi", nameEn: "Tom Thumb", emoji: "👍",
    prompt: "Classic folk tale 'Tom Thumb' (O Palečkovi): a boy tiny as a thumb rides in a horse's ear, helps with ploughing, slips through keyholes and outsmarts everyone who underestimates him. Tiny hero in a giant world: huge blades of grass, teacup boats." },
  { id: "folk_obusek", name: "Obušku, z pytle ven!", nameEn: "Cudgel, Out of the Bag!", emoji: "🎒",
    prompt: "Czech classic 'Obušku, z pytle ven!' (K. J. Erben): a poor man receives a table that sets itself and a golden donkey; when a sneaky innkeeper swaps them, the magic bag with a jumping cudgel puts things right. Justice with gentle humor, nobody truly hurt. Country inn, magic table feast." },
  { id: "folk_petrovsti", name: "Zvířátka a Petrovští", nameEn: "The Animals and the Robbers", emoji: "🐓",
    prompt: "Czech classic 'Zvířátka a Petrovští': a rooster, cat, dog and other animals travel together, find a cottage of robbers in the forest and scare them away with their night concert — then live there happily. Animal teamwork, dark forest turned cozy home, comic robbers running away." },
  { id: "folk_kocour", name: "Kocour v botách", nameEn: "Puss in Boots", emoji: "🐱",
    prompt: "Classic tale 'Puss in Boots' (Charles Perrault): a clever cat in fine boots makes his poor master's fortune through wit — greeting the king, outsmarting a shape-shifting ogre in his castle. Elegant trickster cat, royal carriage, grand castle." },
  { id: "folk_kralovna", name: "Sněhová královna", nameEn: "The Snow Queen", emoji: "🌨️",
    prompt: "Classic tale 'The Snow Queen' (H. Ch. Andersen): brave Gerda journeys across the world to free her friend Kai from the icy palace of the Snow Queen, where a splinter of a magic mirror froze his heart — warmth and friendship melt the ice. Ice palace, rose garden, reindeer ride, northern lights." },
  { id: "folk_kacatko", name: "Ošklivé káčátko", nameEn: "The Ugly Duckling", emoji: "🦢",
    prompt: "Classic tale 'The Ugly Duckling' (H. Ch. Andersen): a duckling mocked for being different wanders through seasons alone — and in spring discovers he is a beautiful swan. Warm message: everyone blooms in their own time. Pond, farmyard, winter reeds, spring lake with swans." },
  { id: "folk_saty", name: "Císařovy nové šaty", nameEn: "The Emperor's New Clothes", emoji: "👔",
    prompt: "Classic tale 'The Emperor's New Clothes' (H. Ch. Andersen): two tricksters weave 'invisible' cloth only clever people can see; everyone pretends — until a child says the truth out loud. Comic royal parade, weaving workshop with empty looms, honest little child." },
  { id: "folk_hrasek", name: "Princezna na hrášku", nameEn: "The Princess and the Pea", emoji: "🫛",
    prompt: "Classic tale 'The Princess and the Pea' (H. Ch. Andersen): on a stormy night a rain-soaked girl claims to be a princess; a single pea under twenty mattresses and twenty featherbeds proves it. Cozy castle, comically tall tower of mattresses, stormy night." },
  { id: "folk_kuzlatka", name: "Vlk a sedm kůzlátek", nameEn: "The Wolf and the Seven Kids", emoji: "🐐",
    prompt: "Classic tale 'The Wolf and the Seven Little Kids' (Grimm): seven little goats home alone must not open the door; the wolf disguises his voice and paws, but the smallest kid hides in the clock case and all ends well. Gentle retelling, kids rescued unharmed. Cottage, clock hiding place." },
  { id: "folk_muzikanti", name: "Brémští muzikanti", nameEn: "The Bremen Town Musicians", emoji: "🎶",
    prompt: "Classic tale 'The Bremen Town Musicians' (Grimm): an old donkey, dog, cat and rooster set off to become town musicians; their midnight 'concert' scares robbers out of a cottage that becomes their home. Animal friendship, stacked-animals silhouette, moonlit road." },
];

export function folkTaleById(id: string): FolkTale | undefined {
  return FOLK_TALES.find(t => t.id === id);
}
