"use client";

import { useMemo, useState } from "react";
import StoryCatalogScreen, { type CatalogStory } from "../cd/StoryCatalogScreen";
import StoryWorldStep, { type WorldTile } from "../cd/StoryWorldStep";
import StoryDetailsStep from "../cd/StoryDetailsStep";
import GenerationProgressScreen from "../cd/GenerationProgressScreen";
import styles from "./page.module.css";

const A = "/cd-assets";
const worlds: WorldTile[] = [
  { id: "dinosauri", name: "Dinosauři", image: `${A}/svety/webp/dinosauri.webp`, minAge: 3, maxAge: 10 },
  { id: "krkonose", name: "Krkonoše", image: `${A}/svety/webp/krkonose.webp`, minAge: 3, maxAge: 12 },
  { id: "kouzelny-les", name: "Kouzelný les", image: `${A}/svety/webp/kouzelny-les.webp`, minAge: 2, maxAge: 10 },
  { id: "vesmir", name: "Vesmír", image: `${A}/svety/webp/vesmir.webp`, minAge: 5, maxAge: 12 },
];
const stories: CatalogStory[] = [
  { id: "karkulka", name: "Červená karkulka", group: "České pohádky", image: `${A}/katalog/webp/c-karkulka.webp`, bigImage: `${A}/katalog/big-webp/c-karkulka.webp`, description: "Klasická pohádka v novém dobrodružství.", minAge: 3, maxAge: 8, supportsOriginal: true },
  { id: "popelka", name: "Popelka", group: "České pohádky", image: `${A}/katalog/webp/c-popelka.webp`, bigImage: `${A}/katalog/big-webp/c-popelka.webp`, description: "O odvaze, laskavosti a splněném přání.", minAge: 5, maxAge: 12, supportsOriginal: true },
  { id: "dinosauri", name: "Dinosauři", group: "Svět", image: `${A}/katalog/webp/m-dinosauri.webp`, bigImage: `${A}/katalog/big-webp/m-dinosauri.webp`, description: "Výprava do pravěkého světa.", minAge: 3, maxAge: 10 },
];

export default function CdPreviewPage() {
  const [screen, setScreen] = useState<"world" | "catalog" | "details" | "progress">("world");
  const [world, setWorld] = useState(worlds[0]);
  const [motif, setMotif] = useState("Nicolásek a Vája objevují tajemství nového světa.");
  const [length, setLength] = useState(8);
  const selected = useMemo(() => [{ id: "nicolas", name: "Nicolásek", avatar: `${A}/katalog/webp/a-hrasek.webp`, selected: true }, { id: "valentyna", name: "Vája", avatar: `${A}/katalog/webp/a-malenka.webp`, selected: true }], []);
  if (screen === "catalog") return <div className={styles.previewViewport}><StoryCatalogScreen backgroundImage={`${A}/svety/big/krkonose.jpg`} stories={stories} onBack={() => setScreen("world")} onPick={(s) => { setMotif(`${s.name} — nové dobrodružství Nicoláska a Váji.`); setScreen("details"); }} /></div>;
  if (screen === "details") return <div className={styles.previewViewport}><StoryDetailsStep backgroundImage={`${A}/svety/big/${world.id}.jpg`} worldName={world.name} worldImage={world.image} motif={motif} onMotifChange={setMotif} characters={selected} length={length} onLengthChange={setLength} onBackToWorld={() => setScreen("world")} onBack={() => setScreen("world")} onSubmit={() => setScreen("progress")} /></div>;
  if (screen === "progress") return <div className={styles.previewViewport}><GenerationProgressScreen step={2} subIndex={1} onCancel={() => setScreen("details")} /></div>;
  return <div className={styles.previewViewport}><StoryWorldStep mobilePreview backgroundImage={`${A}/svety/big/krkonose.jpg`} readyWorlds={worlds} ownWorlds={[]} selectedId={world.id} onSelect={(id) => setWorld(worlds.find((w) => w.id === id) ?? worlds[0])} onOpenCatalog={() => setScreen("catalog")} onContinue={() => setScreen("details")} /></div>;
}
