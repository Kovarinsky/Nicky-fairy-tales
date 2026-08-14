"use client";

import { useEffect, useMemo, useState } from "react";
import StoryCatalogScreen, { type CatalogStory } from "../cd/StoryCatalogScreen";
import StoryWorldStep, { type WorldTile } from "../cd/StoryWorldStep";
import StoryDetailsStep from "../cd/StoryDetailsStep";
import GenerationProgressScreen from "../cd/GenerationProgressScreen";
import CreateWorldScreen from "../cd/CreateWorldScreen";
import NewCharacterScreen from "../cd/NewCharacterScreen";
import VoiceSelectionScreen, { type VoiceItem } from "../cd/VoiceSelectionScreen";
import HomeScreen from "../cd/HomeScreen";
import ReaderScreen from "../cd/ReaderScreen";
import StoryEndScreen from "../cd/StoryEndScreen";
import BonusSongScreen from "../cd/BonusSongScreen";
import StoryLibraryScreen from "../cd/StoryLibraryScreen";
import styles from "./page.module.css";
import catalogData from "../../docs/cd-handoff/vFinal4/classic-tales.final.json";

const A = "/cd-assets";
const worlds: WorldTile[] = [
  { id: "dinosauri", name: "Dinosauři", image: `${A}/svety/webp/dinosauri.webp`, minAge: 3, maxAge: 10 },
  { id: "krkonose", name: "Krkonoše", image: `${A}/svety/webp/krkonose.webp`, minAge: 3, maxAge: 12 },
  { id: "kouzelny-les", name: "Kouzelný les", image: `${A}/svety/webp/kouzelny-les.webp`, minAge: 2, maxAge: 10 },
  { id: "vesmir", name: "Vesmír", image: `${A}/svety/webp/vesmir.webp`, minAge: 5, maxAge: 12 },
];
const stories: CatalogStory[] = catalogData.tales.map((tale) => ({
  id: tale.id,
  name: tale.nameCz,
  group: tale.group,
  image: `${A}/katalog/webp/${tale.imageFile.replace(/\.jpg$/i, ".webp")}`,
  bigImage: `${A}/katalog/big-webp/${tale.imageFile.replace(/\.jpg$/i, ".webp")}`,
  description: tale.descCz,
  minAge: tale.minAge,
  maxAge: tale.maxAge,
  supportsOriginal: tale.supportsOriginal,
}));

export default function CdPreviewPage() {
  const [screen, setScreen] = useState<"home" | "world" | "catalog" | "details" | "progress" | "createWorld" | "newCharacter" | "voice" | "reader" | "end" | "song" | "library">("home");
  const [world, setWorld] = useState(worlds[0]);
  const [motif, setMotif] = useState("Nicolásek a Vája objevují tajemství nového světa.");
  const [length, setLength] = useState(8);
  const [worldName, setWorldName] = useState("");
  const [worldDescription, setWorldDescription] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [characterDescription, setCharacterDescription] = useState("");
  const [selectedVoiceId, setSelectedVoiceId] = useState("zena");
  const [generationStep, setGenerationStep] = useState<1 | 2 | 3>(1);
  const [readerPage, setReaderPage] = useState(1);
  const [readerPlaying, setReaderPlaying] = useState(false);
  const [songPlaying, setSongPlaying] = useState(true);
  const voices: VoiceItem[] = [
    { id: "zena", name: "Žena", image: `${A}/katalog/webp/a-malenka.webp` },
    { id: "muz", name: "Muž", image: `${A}/katalog/webp/a-hrasek.webp` },
    { id: "dite", name: "Dítě", image: `${A}/katalog/webp/a-malenka.webp` },
  ];
  const homeBackgrounds = [
    { id: "storybook", name: "Pohádkový les", image: "/bg-intro-v2.png" },
    { id: "krkonose", name: "Krkonoše", image: `${A}/svety/big/krkonose.jpg` },
    { id: "kouzelny-les", name: "Kouzelný les", image: `${A}/svety/big/kouzelny-les.jpg` },
  ];
  const selectedVoice = voices.find((voice) => voice.id === selectedVoiceId) ?? voices[0];
  const selected = useMemo(() => [{ id: "nicolas", name: "Nicolásek", avatar: `${A}/katalog/webp/a-hrasek.webp`, selected: true }, { id: "valentyna", name: "Vája", avatar: `${A}/katalog/webp/a-malenka.webp`, selected: true }], []);
  useEffect(() => {
    if (screen !== "progress") return;
    setGenerationStep(1);
    const step2 = window.setTimeout(() => setGenerationStep(2), 700);
    const step3 = window.setTimeout(() => setGenerationStep(3), 1400);
    const done = window.setTimeout(() => { setReaderPage(1); setScreen("reader"); }, 2200);
    return () => { window.clearTimeout(step2); window.clearTimeout(step3); window.clearTimeout(done); };
  }, [screen]);
  if (screen === "home") return <div className={styles.previewViewport}><HomeScreen backgroundOptions={homeBackgrounds} version="vFinal3" onStart={() => setScreen("world")} /></div>;
  if (screen === "catalog") return <div className={styles.previewViewport}><StoryCatalogScreen backgroundImage={`${A}/svety/big/krkonose.jpg`} stories={stories} onBack={() => setScreen("world")} onPick={(s) => { setMotif(`${s.name} — nové dobrodružství Nicoláska a Váji.`); setScreen("details"); }} /></div>;
  if (screen === "details") return <div className={styles.previewViewport}><StoryDetailsStep backgroundImage={`${A}/svety/big/${world.id}.jpg`} worldName={world.name} worldImage={world.image} motif={motif} onMotifChange={setMotif} characters={selected} voice={selectedVoice} length={length} onLengthChange={setLength} onOpenCharacter={() => setScreen("newCharacter")} onAddCharacter={() => setScreen("newCharacter")} onOpenVoice={() => setScreen("voice")} onBackToWorld={() => setScreen("world")} onBack={() => setScreen("world")} onSubmit={() => setScreen("progress")} /></div>;
  if (screen === "progress") return <div className={styles.previewViewport}><GenerationProgressScreen step={generationStep} subIndex={generationStep - 1} onCancel={() => setScreen("details")} /></div>;
  if (screen === "reader") return <div className={styles.previewViewport}><ReaderScreen backgroundImage={`${A}/svety/big/${world.id}.jpg`} sentences={[readerPage === 1 ? "Nicolásek a Vája vstoupili do kouzelného světa." : readerPage === 2 ? "Za stromy zazářilo světlo a ukázalo jim tajnou cestu." : "Společně se vrátili domů a věděli, že dobrodružství nekončí."]} playing={readerPlaying} onPlayToggle={() => setReaderPlaying((v) => !v)} page={readerPage} pageCount={3} onPageChange={(page) => page >= 3 ? setReaderPage(3) : setReaderPage(Math.max(1, page))} onPrevPage={() => setReaderPage((p) => Math.max(1, p - 1))} onNextPage={() => readerPage >= 3 ? setScreen("end") : setReaderPage((p) => p + 1)} /></div>;
  if (screen === "end") return <div className={styles.previewViewport}><StoryEndScreen backgroundImage={`${A}/svety/big/${world.id}.jpg`} onClose={() => setScreen("library")} onPlayBonusSong={() => { setSongPlaying(true); setScreen("song"); }} onReread={() => { setReaderPage(1); setScreen("reader"); }} onBackToLibrary={() => setScreen("library")} /></div>;
  if (screen === "song") return <div className={styles.previewViewport}><BonusSongScreen coverImage={`${A}/svety/webp/${world.id}.webp`} title={`Písnička ze světa ${world.name}`} status={songPlaying ? "playing" : "paused"} progress={40} onTogglePlay={() => setSongPlaying((v) => !v)} onDone={() => setScreen("library")} /></div>;
  if (screen === "library") return <div className={styles.previewViewport}><StoryLibraryScreen stories={[{ id: "demo", title: motif, cover: `${A}/svety/big/${world.id}.jpg`, relativeDate: "Právě vytvořeno" }]} onBack={() => setScreen("home")} onPlay={() => { setReaderPage(1); setScreen("reader"); }} onCreateFirst={() => setScreen("world")} /></div>;
  if (screen === "createWorld") return <div className={styles.previewViewport}><CreateWorldScreen backgroundImage={`${A}/svety/big/kouzelny-les.jpg`} name={worldName} onNameChange={setWorldName} description={worldDescription} onDescriptionChange={setWorldDescription} photos={[]} onAddPhoto={() => {}} link="" onSave={() => setScreen("world")} onBack={() => setScreen("world")} onCancel={() => setScreen("world")} /></div>;
  if (screen === "newCharacter") return <div className={styles.previewViewport}><NewCharacterScreen backgroundImage={`${A}/svety/big/kouzelny-les.jpg`} name={characterName} onNameChange={setCharacterName} description={characterDescription} onDescriptionChange={setCharacterDescription} onAddPhoto={() => {}} onTakePhoto={() => {}} onSave={() => setScreen("details")} onBack={() => setScreen("details")} onCancel={() => setScreen("details")} /></div>;
  if (screen === "voice") return <div className={styles.previewViewport}><VoiceSelectionScreen backgroundImage={`${A}/svety/big/kouzelny-les.jpg`} voices={voices} premiumVoices={voices.slice(0, 2)} selectedVoiceId={selectedVoiceId} onSelectVoice={setSelectedVoiceId} onBack={() => setScreen("details")} onConfirm={(id) => { setSelectedVoiceId(id); setScreen("details"); }} /></div>;
  return <div className={styles.previewViewport}><StoryWorldStep mobilePreview backgroundImage={`${A}/svety/big/krkonose.jpg`} readyWorlds={worlds} ownWorlds={[]} selectedId={world.id} onSelect={(id) => setWorld(worlds.find((w) => w.id === id) ?? worlds[0])} onOpenCatalog={() => setScreen("catalog")} onCreateNew={() => setScreen("createWorld")} onContinue={() => setScreen("details")} /></div>;
}
