// 👤 Účty pro přenos postav/historie mezi zařízeními (mobil ↔ tablet ↔ web).
// Žádná databáze — účet je jeden JSON záznam ve Vercel Blob (stejně jako
// joby a sdílené pohádky). Heslo se nikdy neukládá v čitelné podobě (scrypt).
// Přihlášení = podepsaný token v httpOnly cookie, žádná session tabulka.

import { put, head } from "@vercel/blob";
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "crypto";
import { blobToken } from "@/lib/blob-token";

export interface AccountRecord {
  username: string; // normalizované (malá písmena) — je i klíčem cesty v Blobu
  salt: string;
  passwordHash: string;
  createdAt: number;
  updatedAt?: number;
  /** Celý synchronizovaný stav appky (historie, postavy, světy, nastavení) */
  data?: unknown;
  /** 💳 Kreditní systém (návrh „na čisto"): 1 kredit = 1 pohádka = 10 Kč.
   *  Server-authoritative pole — NIKDY nesmí žít uvnitř `data` (ten se
   *  bere z klienta jako důvěryhodný celek přes /api/account/sync a
   *  jednoduše by šel přepsat na cokoliv). Mění ho jen registrace
   *  (počáteční dar) a job-runner (odečet po dokončené pohádce). */
  credits?: number;
  /** ✉️ E-mail — appka na něj posílá vygenerované heslo (registrace / obnova)
   *  a slouží jako jednoduchý tracking, kdo appku používá. */
  email?: string;
  /** 📊 Počet doopravdy dokončených pohádek — pro developerský přehled */
  storiesCompleted?: number;
}

/** Nový účet dostává na vyzkoušení tento počet kreditů zdarma. */
export const SIGNUP_FREE_CREDITS = 2;

/** Přičte (nebo odečte, se záporným `delta`) kredity na účtu; vrací nový
 *  zůstatek, nebo null když účet neexistuje. Nechrání proti souběhu dvou
 *  paralelních zápisů (žádná databázová transakce ve Vercel Blobu) — pro
 *  návrh postačí, ostrá verze by potřebovala optimistický zámek/retry. */
export async function adjustCredits(username: string, delta: number): Promise<number | null> {
  const acc = await readAccount(username);
  if (!acc) return null;
  const next = Math.max(0, (acc.credits ?? 0) + delta);
  acc.credits = next;
  acc.updatedAt = Date.now();
  await writeAccount(acc);
  return next;
}

/** Odečet za dokončenou pohádku + zvýšení počítadla pro dev přehled —
 *  v JEDNOM čtení/zápisu (ne dva samostatné adjustCredits+počítadlo volání). */
export async function chargeForCompletedStory(username: string, cost: number): Promise<void> {
  const acc = await readAccount(username);
  if (!acc) return;
  acc.credits = Math.max(0, (acc.credits ?? 0) - cost);
  acc.storiesCompleted = (acc.storiesCompleted ?? 0) + 1;
  acc.updatedAt = Date.now();
  await writeAccount(acc);
}

// ── Heslo generované appkou (registrace / obnova hesla e-mailem) ────────
// Bez matoucích znaků (0/O, 1/l/I) — čte se z e-mailu na telefonu, opisuje ručně
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export function generateTempPassword(length = 10): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  return out;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const USERNAME_RE = /^[a-z0-9_-]{3,30}$/;

export function normalizeUsername(raw: string): string | null {
  const u = raw.trim().toLowerCase();
  return USERNAME_RE.test(u) ? u : null;
}

function accountPath(username: string): string {
  return `accounts/${username}.json`;
}

export async function readAccount(username: string): Promise<AccountRecord | null> {
  try {
    const h = await head(accountPath(username), { token: blobToken() });
    const res = await fetch(`${h.url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as AccountRecord;
  } catch {
    return null;
  }
}

export async function writeAccount(rec: AccountRecord): Promise<void> {
  await put(accountPath(rec.username), JSON.stringify(rec), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token: blobToken(),
  });
}

export function hashPassword(password: string, salt?: string): { salt: string; hash: string } {
  const s = salt || randomBytes(16).toString("hex");
  const hash = scryptSync(password, s, 64).toString("hex");
  return { salt: s, hash };
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const check = scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, "hex");
  if (check.length !== stored.length) return false;
  return timingSafeEqual(check, stored);
}

// ── Přihlašovací token (HMAC podpis, žádná session tabulka) ──────────────
function sessionSecret(): string {
  const explicit = process.env.ACCOUNT_SESSION_SECRET;
  if (explicit && explicit.trim()) return explicit.trim();
  // Pojistka, ať appka funguje i bez ručně nastaveného ACCOUNT_SESSION_SECRET
  // — pro ostrý provoz je ale lepší mít vlastní nezávislé tajemství.
  return `nicky-fallback-secret:${blobToken() || "dev"}`;
}

const SESSION_TTL_MS = 180 * 24 * 3600 * 1000; // 180 dní

export function createSessionToken(username: string): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${username}:${exp}`;
  const sig = createHmac("sha256", sessionSecret()).update(payload).digest("hex");
  return `${payload}:${sig}`;
}

export function verifySessionToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const parts = token.split(":");
  if (parts.length !== 3) return null;
  const [username, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  const expected = createHmac("sha256", sessionSecret()).update(`${username}:${expStr}`).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return username;
}

export const SESSION_COOKIE = "nicky_session";
