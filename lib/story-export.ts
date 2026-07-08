// 💾 Export pohádky do JEDNOHO samostatného HTML souboru: obrázky, text
// i namluvení jsou vložené přímo v něm (data URL). Soubor jde poslat
// Quick Share / Bluetooth bez internetu a přehraje se v prohlížeči offline.

export interface ExportScene {
  narration: string;
  /** data URL obrázku (nebo prázdné) */
  imageUrl: string;
  /** data URL zvuku (nebo prázdné) */
  audioUrl: string;
}

export function buildStoryHtml(title: string, scenes: ExportScene[]): string {
  // </script> uvnitř JSON by ukončil script tag — escapovat <
  const data = JSON.stringify({ title, scenes }).replace(/</g, "\\u003c");
  const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle} — Nickyho pohádky</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: linear-gradient(180deg, #0d1340, #1a237e 60%, #2e1a5e);
    color: #f5f3ff; min-height: 100vh;
    display: flex; align-items: center; justify-content: center; padding: 1rem;
  }
  .card {
    width: min(720px, 100%); background: rgba(13, 19, 64, .88);
    border: 1px solid rgba(255,255,255,.18); border-radius: 22px;
    padding: 1.1rem 1.1rem .9rem; text-align: center;
    box-shadow: 0 12px 56px rgba(0,0,0,.3);
  }
  h1 { font-size: 1.25rem; font-weight: 900; margin-bottom: .75rem; }
  .img { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 14px; background: rgba(255,255,255,.06); }
  .img-empty { display: flex; align-items: center; justify-content: center; font-size: 2.5rem; }
  .text { margin: .8rem .2rem; font-size: 1.02rem; line-height: 1.55; min-height: 3.2em; }
  .controls { display: flex; align-items: center; justify-content: center; gap: .7rem; margin: .4rem 0 .6rem; }
  button {
    min-width: 52px; height: 48px; border-radius: 14px;
    border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.1);
    color: #f5f3ff; font-size: 1.2rem; font-weight: 800; cursor: pointer;
  }
  button:disabled { opacity: .35; }
  .play { min-width: 72px; background: linear-gradient(135deg, #7c4dff, #536dfe); border: none; }
  .num { font-weight: 800; opacity: .85; min-width: 3.5rem; }
  .foot { font-size: .78rem; opacity: .6; }
</style>
</head>
<body>
<div class="card">
  <h1 id="t"></h1>
  <img id="img" class="img" alt="" style="display:none">
  <div id="imgEmpty" class="img img-empty" style="display:none">🖼️</div>
  <p id="text" class="text"></p>
  <div class="controls">
    <button id="prev" aria-label="Předchozí">←</button>
    <button id="play" class="play">▶</button>
    <span id="num" class="num"></span>
    <button id="next" aria-label="Další">→</button>
  </div>
  <p class="foot">✨ Vytvořeno v appce Nickyho pohádky — funguje i bez internetu</p>
</div>
<audio id="au"></audio>
<script id="data" type="application/json">${data}</script>
<script>
(function () {
  var story = JSON.parse(document.getElementById("data").textContent);
  var page = 0, playing = false, auto = false;
  var au = document.getElementById("au");
  var img = document.getElementById("img"), imgEmpty = document.getElementById("imgEmpty");
  document.getElementById("t").textContent = story.title;
  document.title = story.title + " — Nickyho pohádky";

  function render() {
    var s = story.scenes[page];
    if (s.imageUrl) { img.src = s.imageUrl; img.style.display = ""; imgEmpty.style.display = "none"; }
    else { img.style.display = "none"; imgEmpty.style.display = "flex"; }
    document.getElementById("text").textContent = s.narration;
    document.getElementById("num").textContent = (page + 1) + " / " + story.scenes.length;
    document.getElementById("prev").disabled = page === 0;
    document.getElementById("next").disabled = page >= story.scenes.length - 1;
    au.pause(); playing = false; updatePlay();
    document.getElementById("play").disabled = !s.audioUrl;
    if (s.audioUrl) { au.src = s.audioUrl; if (auto) { au.play().then(function () { playing = true; updatePlay(); }).catch(function () {}); } }
  }
  function updatePlay() { document.getElementById("play").textContent = playing ? "⏸" : "▶"; }
  document.getElementById("play").onclick = function () {
    if (playing) { au.pause(); playing = false; auto = false; }
    else { auto = true; au.play().then(function () { playing = true; updatePlay(); }).catch(function () {}); }
    updatePlay();
  };
  document.getElementById("prev").onclick = function () { if (page > 0) { page--; render(); } };
  document.getElementById("next").onclick = function () { if (page < story.scenes.length - 1) { page++; render(); } };
  au.onended = function () {
    playing = false; updatePlay();
    if (page < story.scenes.length - 1) { page++; render(); } else auto = false;
  };
  render();
})();
</script>
</body>
</html>`;
}
