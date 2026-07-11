// 💾 Export pohádky do JEDNOHO samostatného HTML souboru: obrázky, text
// i namluvení jsou vložené přímo v něm (data URL). Soubor jde poslat
// Quick Share / Bluetooth bez internetu a přehraje se v prohlížeči offline.
// Přehrávač vypadá jako čtečka v appce: obrázek přes celý displej,
// titulky v čitelném pruhu dole, velká viditelná tlačítka.
// Umí i pohádku se dvěma konci (🔀 choice) — po společném ději se objeví výběr.

import type { StoryChoiceMeta } from "./types";

export interface ExportScene {
  narration: string;
  /** data URL obrázku (nebo prázdné) */
  imageUrl: string;
  /** data URL zvuku (nebo prázdné) */
  audioUrl: string;
}

export function buildStoryHtml(title: string, scenes: ExportScene[], choice?: StoryChoiceMeta): string {
  // </script> uvnitř JSON by ukončil script tag — escapovat <
  const data = JSON.stringify({ title, scenes, choice: choice ?? null }).replace(/</g, "\\u003c");
  const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>${safeTitle} — Nickyho pohádky</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html, body { height: 100%; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #0a0e2e; color: #ffffff; overflow: hidden;
  }
  #stage { position: fixed; inset: 0; display: flex; flex-direction: column; }
  #title {
    color: #ffffff; font-weight: 900; font-size: 1.05rem; text-align: center;
    padding: .55rem .8rem .35rem; text-shadow: 0 2px 8px rgba(0,0,0,.8);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  #imgwrap { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
  #img { max-width: 100%; max-height: 100%; width: auto; height: auto; display: block; }
  #imgEmpty { font-size: 3rem; display: none; }
  #bar {
    background: rgba(6, 8, 28, .94); border-top: 1px solid rgba(255,255,255,.15);
    padding: .55rem .9rem calc(.6rem + env(safe-area-inset-bottom));
  }
  #text {
    color: #ffffff; font-size: 1.05rem; line-height: 1.5; text-align: center;
    margin-bottom: .55rem; max-height: 4.6em; overflow-y: auto;
  }
  #controls { display: flex; align-items: center; justify-content: center; gap: .9rem; }
  .btn {
    min-width: 64px; height: 52px; border-radius: 15px; border: 2px solid rgba(255,255,255,.55);
    background: #262c55; color: #ffffff; font-size: 1.35rem; font-weight: 900; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .btn:disabled { opacity: .3; }
  #play { min-width: 88px; background: linear-gradient(135deg, #7c4dff, #536dfe); border-color: transparent; font-size: 1.5rem; }
  #num { color: #ffffff; font-weight: 800; font-size: 1rem; min-width: 4rem; text-align: center; }
  /* 🔀 Výběr konce — dvě grafické karty s náhledem cesty */
  #choiceRow { display: none; flex-direction: column; gap: .5rem; margin-top: .3rem; }
  #choiceRow p { text-align: center; font-weight: 900; margin-bottom: .15rem; }
  .ccards { display: flex; gap: .6rem; }
  .ccard {
    flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .4rem;
    padding: .45rem .45rem .55rem; border-radius: 14px; cursor: pointer;
    border: 2px solid rgba(124, 77, 255, .8); background: rgba(255,255,255,.07);
    color: #fff; font-size: .92rem; font-weight: 800;
  }
  .ccard:last-child { border-color: rgba(236, 72, 153, .8); }
  .ccard img { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 9px; display: block; }
  .ccard span { text-align: center; line-height: 1.3; }
  /* Na šířku: titulek zmizí, ať má obrázek celý displej */
  @media (orientation: landscape) and (max-height: 620px) {
    #title { display: none; }
    #text { font-size: .95rem; max-height: 3em; margin-bottom: .4rem; }
    .btn { height: 46px; }
  }
</style>
</head>
<body>
<div id="stage">
  <div id="title"></div>
  <div id="imgwrap">
    <img id="img" alt="">
    <div id="imgEmpty">🖼️</div>
  </div>
  <div id="bar">
    <p id="text"></p>
    <div id="controls">
      <button type="button" class="btn" id="fork" aria-label="Zpět k rozbočce" style="display:none">🔀</button>
      <button type="button" class="btn" id="prev" aria-label="Předchozí">←</button>
      <button type="button" class="btn" id="play">▶&#xFE0E;</button>
      <span id="num"></span>
      <button type="button" class="btn" id="next" aria-label="Další">→</button>
    </div>
    <div id="choiceRow">
      <p>🔀 Jak má pohádka pokračovat?</p>
      <div class="ccards">
        <button type="button" class="ccard" id="optA"><img id="optAimg" alt=""><span id="optAtxt"></span></button>
        <button type="button" class="ccard" id="optB"><img id="optBimg" alt=""><span id="optBtxt"></span></button>
      </div>
    </div>
  </div>
</div>
<audio id="au"></audio>
<script id="data" type="application/json">${data}</script>
<script>
(function () {
  var story = JSON.parse(document.getElementById("data").textContent);
  var choice = story.choice || null;
  var page = 0, playing = false, auto = false, branch = null;
  var au = document.getElementById("au");
  var img = document.getElementById("img"), imgEmpty = document.getElementById("imgEmpty");
  document.getElementById("title").textContent = "📖 " + story.title;
  document.title = story.title + " — Nickyho pohádky";

  function visible() {
    var all = story.scenes.map(function (_, i) { return i; });
    if (!choice) return all;
    if (branch === "A") return all.slice(0, choice.altFrom);
    if (branch === "B") return all.slice(0, choice.common).concat(all.slice(choice.altFrom));
    return all.slice(0, choice.common);
  }

  function render() {
    var vis = visible();
    var pos = Math.max(0, vis.indexOf(page));
    var s = story.scenes[page];
    if (s.imageUrl) { img.src = s.imageUrl; img.style.display = ""; imgEmpty.style.display = "none"; }
    else { img.style.display = "none"; imgEmpty.style.display = "block"; }
    document.getElementById("text").textContent = s.narration;
    document.getElementById("num").textContent = (pos + 1) + " / " + vis.length + (choice && !branch ? "+" : "");
    document.getElementById("prev").disabled = pos === 0;
    document.getElementById("next").disabled = pos >= vis.length - 1;
    var atChoice = choice && !branch && page === choice.common - 1;
    document.getElementById("fork").style.display = choice && branch ? "" : "none";
    document.getElementById("choiceRow").style.display = atChoice ? "flex" : "none";
    if (atChoice) {
      document.getElementById("optAtxt").textContent = "1️⃣ " + choice.options[0];
      document.getElementById("optBtxt").textContent = "2️⃣ " + choice.options[1];
      var imgA = story.scenes[choice.common] && story.scenes[choice.common].imageUrl;
      var imgB = story.scenes[choice.altFrom] && story.scenes[choice.altFrom].imageUrl;
      var elA = document.getElementById("optAimg"), elB = document.getElementById("optBimg");
      if (imgA) { elA.src = imgA; elA.style.display = ""; } else elA.style.display = "none";
      if (imgB) { elB.src = imgB; elB.style.display = ""; } else elB.style.display = "none";
    }
    au.pause(); playing = false; updatePlay();
    document.getElementById("play").disabled = !s.audioUrl;
    if (s.audioUrl) { au.src = s.audioUrl; if (auto) { au.play().then(function () { playing = true; updatePlay(); }).catch(function () {}); } }
  }
  function updatePlay() { document.getElementById("play").textContent = playing ? "⏸︎" : "▶︎"; }
  function go(delta) {
    var vis = visible();
    var pos = Math.max(0, vis.indexOf(page));
    var np = pos + delta;
    if (np < 0 || np >= vis.length) return;
    page = vis[np]; render();
  }
  function pick(b) {
    branch = b; auto = true;
    page = b === "A" ? choice.common : choice.altFrom;
    render();
  }
  document.getElementById("play").onclick = function () {
    if (playing) { au.pause(); playing = false; auto = false; }
    else { auto = true; au.play().then(function () { playing = true; updatePlay(); }).catch(function () {}); }
    updatePlay();
  };
  document.getElementById("prev").onclick = function () { go(-1); };
  document.getElementById("next").onclick = function () { go(1); };
  document.getElementById("optA").onclick = function () { pick("A"); };
  document.getElementById("optB").onclick = function () { pick("B"); };
  document.getElementById("fork").onclick = function () {
    if (!choice || !branch) return;
    branch = null; auto = false; page = choice.common - 1; render();
  };
  au.onended = function () {
    playing = false; updatePlay();
    if (choice && !branch && page === choice.common - 1) return; // čeká na výběr
    var vis = visible();
    var pos = vis.indexOf(page);
    if (pos >= 0 && pos < vis.length - 1) { page = vis[pos + 1]; render(); }
    else auto = false;
  };
  render();
})();
</script>
</body>
</html>`;
}
