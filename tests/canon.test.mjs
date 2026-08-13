import test from "node:test";
import assert from "node:assert/strict";
import { prepareStoryRequestCanon, repairStoryCanonNames, repairStoryNarrationLanguage, repairToddlerSpeech, StoryCanonError, validateStoryCanon } from "../lib/story-canon.ts";
import { hasHardCanonFailure } from "../lib/gemini.ts";

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
const nicolas = { id: "nicolas", name: "Nicolásek", description: "boy" };
const req = { topic: "", characters: [nicolas], age: 5, sceneCount: 1, language: "cs" };

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

test("reserved names in an outline are renamed before a paid model call", () => {
  const prepared = prepareStoryRequestCanon({
    ...req,
    topic: "James, Bella, Jakob a Eva potkají Nicolásek.",
  });
  assert.equal(prepared.renames.length, 4);
  assert.match(prepared.request.topic, /Matěj, Rozárka, Tobiáš a Amálka/);
  assert.match(prepared.request.topic, /Nicolásek/);
  assert.doesNotMatch(prepared.request.topic, /James|Bella|Jakob|Eva/);
});

test("reserved-name validator exposes a non-retryable analytics code", () => {
  assert.throws(
    () => validateStoryCanon(script("Přiběhl James."), req),
    error => error instanceof StoryCanonError && error.code === "RESERVED_LIBRARY_NAME",
  );
});

test("model-invented reserved names are repaired without discarding the story", () => {
  const completed = script("Táta Jan zavolal na děti a Jan jim zamával.");
  completed.imagePrompt = undefined;
  completed.scenes[0].imagePrompt = "Dad Jan waves from the cable car.";
  const repairs = repairStoryCanonNames(completed, req);
  assert.deepEqual(repairs, [{ libraryId: "jan", replacement: "Martin" }]);
  assert.match(completed.scenes[0].narration, /táta Martin/iu);
  assert.doesNotMatch(completed.scenes[0].narration, /\bJan\b/iu);
  assert.match(completed.scenes[0].imagePrompt, /Martin/);
  assert.doesNotThrow(() => validateStoryCanon(completed, req));
});

test("reserved-name repair never changes a name embedded in a Czech word", () => {
  const completed = script("Dřevěná stezka vedla mezi stromy a dětem se líbila.");
  const repairs = repairStoryCanonNames(completed, req);
  assert.deepEqual(repairs, []);
  assert.equal(completed.scenes[0].narration, "Dřevěná stezka vedla mezi stromy a dětem se líbila.");
});

test("isolated English words are removed from Czech narration", () => {
  const completed = script("Máma Jana children přivinula k sobě.");
  assert.equal(repairStoryNarrationLanguage(completed, "cs"), 1);
  assert.equal(completed.scenes[0].narration, "Máma Jana přivinula děti k sobě.");
  assert.equal(repairStoryNarrationLanguage(completed, "en"), 0);
});

test("long Valentýnka speech is locally shortened instead of regenerating the story", () => {
  const toddlerReq = { ...req, characters: [valentyna] };
  const completed = script("Valentýnka se rozzářila a zvolala: „Podívej, mami, opravdový skřítek!“ Pak běžela dál.");
  assert.equal(repairToddlerSpeech(completed, toddlerReq), 1);
  assert.match(completed.scenes[0].narration, /„Skřítek!“/);
  assert.match(completed.scenes[0].narration, /Pak běžela dál/);
  assert.doesNotThrow(() => validateStoryCanon(completed, toddlerReq));
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

test("critical visual identity drift is never deadline-tolerable", () => {
  assert.equal(hasHardCanonFailure({
    ok: false, action: "REDRAW", problems: "wrong hair and age", badRules: 2,
    findings: [
      { rule: 4, severity: "MAJOR", problem: "Valentyna hair extends below shoulders" },
      { rule: 13, severity: "MAJOR", problem: "Nicolas appears too old" },
    ], fixInstruction: "redraw",
  }), true);
  assert.equal(hasHardCanonFailure({
    ok: false, action: "EDIT", problems: "pet gaze", badRules: 1,
    findings: [{ rule: 14, severity: "MAJOR", problem: "Archie looks out of frame" }],
    fixInstruction: "turn Archie toward Nicolas",
  }), false);
});
