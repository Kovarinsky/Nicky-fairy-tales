// 💾 Export pohádky do JEDNOHO samostatného HTML souboru: obrázky, text
// i namluvení jsou vložené přímo v něm (data URL). Soubor jde poslat
// Quick Share / Bluetooth bez internetu a přehraje se v prohlížeči offline.
// Přehrávač vypadá jako čtečka v appce: obrázek přes celý displej,
// titulky v čitelném pruhu dole, velká viditelná tlačítka.

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
      <button type="button" class="btn" id="prev" aria-label="Předchozí">←</button>
      <button type="button" class="btn" id="play">▶&#xFE0E;</button>
      <span id="num"></span>
      <button type="button" class="btn" id="next" aria-label="Další">→</button>
    </div>
  </div>
</div>
<audio id="au"></audio>
<script id="data" type="application/json">${data}</script>
<script>
(function () {
  var story = JSON.parse(document.getElementById("data").textContent);
  var page = 0, playing = false, auto = false;
  var au = document.getElementById("au");
  var img = document.getElementById("img"), imgEmpty = document.getElementById("imgEmpty");
  document.getElementById("title").textContent = "📖 " + story.title;
  document.title = story.title + " — Nickyho pohádky";

  function render() {
    var s = story.scenes[page];
    if (s.imageUrl) { img.src = s.imageUrl; img.style.display = ""; imgEmpty.style.display = "none"; }
    else { img.style.display = "none"; imgEmpty.style.display = "block"; }
    document.getElementById("text").textContent = s.narration;
    document.getElementById("num").textContent = (page + 1) + " / " + story.scenes.length;
    document.getElementById("prev").disabled = page === 0;
    document.getElementById("next").disabled = page >= story.scenes.length - 1;
    au.pause(); playing = false; updatePlay();
    document.getElementById("play").disabled = !s.audioUrl;
    if (s.audioUrl) { au.src = s.audioUrl; if (auto) { au.play().then(function () { playing = true; updatePlay(); }).catch(function () {}); } }
  }
  function updatePlay() { document.getElementById("play").textContent = playing ? "⏸\uFE0E" : "▶\uFE0E"; }
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
