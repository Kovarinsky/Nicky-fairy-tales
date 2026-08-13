import test from "node:test";
import assert from "node:assert/strict";
import { validateStoryCanon } from "../lib/story-canon.ts";

const cues = [
  { effect: "bell_ring", at: 0.2 },
  { effect: "giggle", at: 0.7, voice: "f" },
];

function script(narration, sfxCues = cues) {
  return {
    title: "Test",
    heroDescription: "",
    scenes: [{ index: 1, narration, imagePrompt: "A bell rings and a child giggles.", soundscape: "cozy", sfxCues }],
  };
}

const valentyna = { id: "valentyna", name: "Valentýnka", description: "toddler" };
const james = { id: "james", name: "James", description: "boy" };

test("Valentýnka may use only one- or two-word toddler speech", () => {
  const req = { topic: "", characters: [valentyna], age: 5, sceneCount: 1, language: "cs" };
  assert.doesNotThrow(() => validateStoryCanon(script("„Já taky,“ řekla Valentýnka."), req));
  assert.throws(
    () => validateStoryCanon(script("„Pojď za mnou domů,“ řekla Valentýnka."), req),
    /delší než dvouslovnou/
  );
});

test("unselected library names cannot be assigned to invented characters", () => {
  const req = { topic: "", characters: [valentyna], age: 5, sceneCount: 1, language: "cs" };
  assert.throws(() => validateStoryCanon(script("Přiběhl nový kamarád James."), req), /rezervované jméno/);
  assert.doesNotThrow(() => validateStoryCanon(script("James zazvonil a zasmál se."), { ...req, characters: [james] }));
});

test("every new scene requires two distinct separated sound cues", () => {
  const req = { topic: "", characters: [james], age: 5, sceneCount: 1, language: "cs" };
  assert.throws(
    () => validateStoryCanon(script("James zazvonil.", [{ effect: "bell_ring", at: 0.2 }]), req),
    /dva odlišné/
  );
  assert.throws(
    () => validateStoryCanon(script("James zazvonil dvakrát.", [{ effect: "bell_ring", at: 0.2 }, { effect: "bell_ring", at: 0.7 }]), req),
    /dva odlišné/
  );
});
