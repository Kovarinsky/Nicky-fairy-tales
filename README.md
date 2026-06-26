# 📖 Nickyho pohádky

AI generátor mluvených pohádek pro Nicolase – à la Google Storybook, ale poskládaný
ze tří nejlepších nástrojů na svou roli:

| Nástroj | Role |
|---|---|
| **Claude** (`@anthropic-ai/sdk`) | Vymyslí a napíše příběh, rozdělí ho na scény |
| **Gemini „Nano Banana"** (`@google/genai`, `gemini-2.5-flash-image`) | Ke každé scéně nakreslí ilustraci (s konzistentním hrdinou) |
| **ElevenLabs** (`@elevenlabs/elevenlabs-js`) | Namluví text realistickým českým hlasem |

Výstup je interaktivní webová „knížka" – stránky s obrázkem a tlačítkem pro přehrání vyprávění.

## Jak to funguje

```
formulář (téma, jméno, věk, počet stránek)
        │
        ▼
  POST /api/story   → Claude vrátí scénář (JSON: title, heroDescription, scenes[])
        │
        ▼  pro každou scénu:
  POST /api/scene   → Nano Banana (obrázek)  +  ElevenLabs (audio)   [paralelně]
        │
        ▼
  knížka v prohlížeči – listování + přehrávání
```

## Spuštění lokálně

```bash
# 1. závislosti
npm install

# 2. klíče
cp .env.example .env.local
#   …a doplň ANTHROPIC_API_KEY, GEMINI_API_KEY, ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID

# 3. dev server
npm run dev
# → http://localhost:3000
```

### Kde vzít klíče

- **ANTHROPIC_API_KEY** – <https://console.anthropic.com> → Settings → API Keys
- **GEMINI_API_KEY** – <https://aistudio.google.com> → Get API key
- **ELEVENLABS_API_KEY** – <https://elevenlabs.io> → Profile → API key
- **ELEVENLABS_VOICE_ID** – vyber český hlas ve [Voice Library](https://elevenlabs.io/app/voice-library) a zkopíruj jeho Voice ID

> Story endpoint (`/api/story`) běží jen na Claude – jde otestovat hned po dodání
> samotného `ANTHROPIC_API_KEY`, ještě bez Gemini/ElevenLabs.
>
> **Pozn. ke Gemini:** obrázkový model (Nano Banana) vyžaduje projekt se **zapnutým
> billingem** – na free tier má limit 0. ~0,039 $ / obrázek.

### Ověření ElevenLabs hlasu

```bash
npm run test:voice
```

Ověří klíč, vypíše dostupné hlasy (i české z Voice Library) s jejich Voice ID a namluví
krátkou českou ukázku do `voice-sample.mp3`. Vybraný `voice_id` pak vlož do `ELEVENLABS_VOICE_ID`.

## Struktura

```
app/
  page.tsx              # formulář + listovací knížka (client)
  layout.tsx, globals.css
  api/
    story/route.ts      # Claude → scénář
    scene/route.ts      # Nano Banana + ElevenLabs → obrázek + audio pro 1 scénu
lib/
  claude.ts             # generování příběhu
  gemini.ts             # generování ilustrací (konzistence hrdiny)
  elevenlabs.ts         # text-to-speech
  types.ts              # sdílené typy
```

## Stav / roadmap

- [x] Kostra Next.js + TypeScript
- [x] Generátor příběhu (Claude)
- [x] Generátor ilustrací (Nano Banana)
- [x] Namluvení (ElevenLabs)
- [x] Interaktivní knížka (frontend)
- [ ] Ukládání pohádek (teď se média vrací jako data URL, nepřetrvávají)
- [ ] Referenční obrázek hrdiny pro ještě lepší konzistenci
- [ ] Nasazení na Vercel
- [ ] Volba/náhled hlasů přímo v UI

## Poznámky

- Pro MVP se obrázky i audio vrací jako **data URL (base64)** – není potřeba řešit
  úložiště. Pro nasazení doporučeno přepnout na ukládání do `/public/stories` nebo blob storage.
- Český hlas: model `eleven_multilingual_v2`. Lze přepnout na `eleven_v3` (expresivnější, dražší).
