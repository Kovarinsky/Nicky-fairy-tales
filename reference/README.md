# reference/ — postavy a jejich fotky

Tahle složka drží **referenční fotky dětí** a jejich konfiguraci. Slouží k tomu, aby
postavy ve vygenerovaných ilustracích vypadaly jako vaše děti.

> ⚠️ **Soukromí:** fotky (`*.jpg/*.png`) ani `characters.json` se **necommitují** —
> jsou v `.gitignore`. Verzuje se jen tenhle README a `characters.example.json`.

## Nastavení

1. Zkopíruj vzor:
   ```bash
   cp reference/characters.example.json reference/characters.json
   ```
2. Vlož sem fotky dětí, např. `nicolas.jpg`, `valentyna.jpg`
   (nejlépe ostrý, dobře osvětlený záběr obličeje zepředu).
3. Uprav `reference/characters.json` — `name` (jak má postava vystupovat),
   `description` (anglicky, pomáhá generátoru) a `referenceFile` (název fotky).

Postavy se pak objeví ve formuláři appky jako zaškrtávátka.

## Formát `characters.json`

```json
[
  {
    "id": "nicolas",
    "name": "Nicolásek",
    "description": "a cheerful young boy with light blond hair",
    "referenceFile": "nicolas.jpg"
  }
]
```
