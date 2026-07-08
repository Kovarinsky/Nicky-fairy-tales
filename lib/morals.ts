// Ponaučení pohádky — volitelný „mravní kompas" příběhu.
// Uživatel si vybere z rolovací nabídky; text (desc/descEn) se předá Claudovi
// s instrukcí vplést ponaučení přirozeně do děje (bez kázání).

export interface Moral {
  id: string;
  emoji: string;
  /** Krátký název pro chip/nabídku (cs) */
  name: string;
  nameEn: string;
  /** Plné znění ponaučení pro vypravěče (cs) */
  desc: string;
  descEn: string;
}

export const MORALS: Moral[] = [
  {
    id: "moral_pomoc", emoji: "🤝",
    name: "Pomáhat druhým", nameEn: "Helping others",
    desc: "Pomáhat druhým, i když z toho sám nic nemám — dobrý skutek se vždycky vrátí.",
    descEn: "Helping others even when there is nothing in it for me — a good deed always comes back.",
  },
  {
    id: "moral_odvaha", emoji: "🦁",
    name: "Odvaha překonat strach", nameEn: "Courage over fear",
    desc: "I když se bojím, můžu najít odvahu — strach je v pořádku, ale nesmí rozhodovat za mě.",
    descEn: "Even when I am scared I can find courage — fear is okay, but it must not decide for me.",
  },
  {
    id: "moral_pravda", emoji: "🗣️",
    name: "Mluvit pravdu", nameEn: "Telling the truth",
    desc: "Říkat pravdu, i když je to těžké — lež všechno jen zamotá, pravda věci napraví.",
    descEn: "Telling the truth even when it is hard — a lie only tangles things up, the truth sets them right.",
  },
  {
    id: "moral_rozdelit", emoji: "🍰",
    name: "Umět se rozdělit", nameEn: "Sharing",
    desc: "Rozdělit se s ostatními — sdílená radost je dvojnásobná radost.",
    descEn: "Sharing with others — joy shared is joy doubled.",
  },
  {
    id: "moral_vytrvalost", emoji: "⛰️",
    name: "Nevzdávat se", nameEn: "Never giving up",
    desc: "Nevzdávat se, když se něco nepovede napoprvé — zkusit to znovu a jinak.",
    descEn: "Not giving up when something fails the first time — trying again in a new way.",
  },
  {
    id: "moral_trpelivost", emoji: "🐌",
    name: "Trpělivost", nameEn: "Patience",
    desc: "Mít trpělivost — některé věci potřebují čas a spěch je jen pokazí.",
    descEn: "Being patient — some things need time and rushing only spoils them.",
  },
  {
    id: "moral_spoluprace", emoji: "🧩",
    name: "Spolupráce", nameEn: "Teamwork",
    desc: "Společně dokážeme víc než každý sám — každý umí něco jiného a to je naše síla.",
    descEn: "Together we achieve more than alone — everyone is good at something different and that is our strength.",
  },
  {
    id: "moral_laskavost", emoji: "💛",
    name: "Laskavost k nejmenším", nameEn: "Kindness to the small",
    desc: "Být laskavý i k těm nejmenším a nejslabším — i malý brouček může být velký přítel.",
    descEn: "Being kind even to the smallest and weakest — even a tiny beetle can be a great friend.",
  },
  {
    id: "moral_omluva", emoji: "🕊️",
    name: "Omluvit se a odpustit", nameEn: "Saying sorry & forgiving",
    desc: "Umět se omluvit, když něco pokazím, a umět odpustit, když se omluví někdo mně.",
    descEn: "Being able to say sorry when I break something, and to forgive when someone says sorry to me.",
  },
  {
    id: "moral_poslouchat", emoji: "👂",
    name: "Poslouchat rodiče", nameEn: "Listening to parents",
    desc: "Naslouchat radám rodičů — nezakazují věci naschvál, ale protože mě chrání.",
    descEn: "Listening to parents' advice — they do not forbid things out of spite, but to keep me safe.",
  },
  {
    id: "moral_poradek", emoji: "🧹",
    name: "Uklízet po sobě", nameEn: "Tidying up",
    desc: "Uklízet po sobě a starat se o své věci — v pořádku se všechno lépe najde.",
    descEn: "Tidying up after myself and caring for my things — everything is easier to find in order.",
  },
  {
    id: "moral_jinakost", emoji: "🌈",
    name: "Každý jsme jiný", nameEn: "Everyone is different",
    desc: "Každý jsme jiný a to je dobře — odlišnost není chyba, ale dar.",
    descEn: "Everyone is different and that is good — being different is not a flaw but a gift.",
  },
  {
    id: "moral_vdecnost", emoji: "🙏",
    name: "Vděčnost za maličkosti", nameEn: "Gratitude",
    desc: "Všímat si obyčejných hezkých věcí a být za ně vděčný — štěstí bydlí v maličkostech.",
    descEn: "Noticing the small everyday joys and being grateful for them — happiness lives in little things.",
  },
];

export function moralById(id: string): Moral | undefined {
  return MORALS.find((m) => m.id === id);
}
