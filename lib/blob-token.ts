// Vercel pojmenuje Blob token s prefixem podle názvu store (např.
// NICKY_FAIRY_TALES_BLOB_READ_WRITE_TOKEN) — najdi ho pod libovolným názvem.
export function blobToken(): string | undefined {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const key = Object.keys(process.env).find(k => k.endsWith("_READ_WRITE_TOKEN"));
  return key ? process.env[key] : undefined;
}
