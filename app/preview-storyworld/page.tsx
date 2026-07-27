"use client";
import { useState } from "react";
import StoryWorldStep from "../StoryWorldStep";

// 🩺 DOČASNÝ izolovaný náhled se vzorovými daty — appka ho NEPOUŽÍVÁ,
// jen ať jde vidět vzhled PŘED napojením do reálného flow. Smazat, jakmile
// se rozhodne, jestli se StoryWorldStep skutečně napojí.

const READY = [
  { id: "krtecek", name: "🦔 Krteček" },
  { id: "mickey", name: "🐭 Mickey Mouse" },
  { id: "dino", name: "🦕 Dinosauři" },
  { id: "vesmir", name: "🚀 Vesmír" },
];
const OWN = [
  { id: "ctheme_1", name: "🌍 Spasitel" },
  { id: "ctheme_2", name: "🏢 JK Advisory" },
];

export default function Preview() {
  const [selectedId, setSelectedId] = useState("mickey");
  const [localEnabled, setLocalEnabled] = useState(false);
  return (
    <div className="cd-phone-frame">
      <StoryWorldStep
        readyWorlds={READY}
        ownWorlds={OWN}
        selectedId={selectedId}
        onSelect={setSelectedId}
        localEnabled={localEnabled}
        onToggleLocal={() => setLocalEnabled(v => !v)}
        onBack={() => {}}
        onContinue={() => {}}
        onOpenCatalog={() => {}}
        onCreateNew={() => {}}
      />
    </div>
  );
}
