// Vercel pojmenuje Blob token s prefixem podle názvu store (např.
// NICKY_FAIRY_TALES_BLOB_READ_WRITE_TOKEN) — najdi ho pod libovolným názvem.
// Hodnota se navíc čistí: při ručním vkládání do Vercelu se do ní snadno
// dostanou uvozovky, nové řádky nebo celý řádek z Quickstartu — token pak
// neprojde jako HTTP hlavička ("invalid header value").
function sanitize(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Ideálně vytáhnout přímo tvar vercel_blob_rw_... (vše ostatní je smetí)
  const m = raw.match(/vercel_blob_rw_[A-Za-z0-9_]+/);
  if (m) return m[0];
  // Jinak aspoň odstranit neviditelné znaky, uvozovky a mezery
  const cleaned = raw.replace(/[^\x21-\x7E]/g, "").replace(/["']/g, "").trim();
  return cleaned || undefined;
}

export function blobToken(): string | undefined {
  const direct = sanitize(process.env.BLOB_READ_WRITE_TOKEN);
  if (direct) return direct;
  const key = Object.keys(process.env).find(k => k.endsWith("_READ_WRITE_TOKEN"));
  return key ? sanitize(process.env[key]) : undefined;
}
