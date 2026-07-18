// GET  /api/account/sync → vrátí uložený stav účtu (historie, postavy,
//      světy, nastavení) — appka ho po přihlášení stáhne a sloučí.
// POST /api/account/sync { data } → přepíše stav účtu (appka volá po každé
//      změně, s prodlevou, ať se nezapisuje při každém úhozu).

import { NextRequest, NextResponse } from "next/server";
import { blobToken } from "@/lib/blob-token";
import { verifySessionToken, readAccount, writeAccount, SESSION_COOKIE } from "@/lib/accounts";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_DATA_BYTES = 8 * 1024 * 1024; // 8 MB — jen text (žádné obrázky/audio)

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function GET(req: NextRequest) {
  if (!blobToken()) return bad("Účty nejsou nastaveny (chybí Blob úložiště).", 501);
  const username = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!username) return bad("Nepřihlášeno.", 401);
  const account = await readAccount(username);
  if (!account) return bad("Účet nenalezen.", 404);
  return NextResponse.json({ data: account.data ?? null });
}

// Union podle id (nikdy nemaže) — zrcadlí stejnojmennou funkci na klientovi
// (app/page.tsx), použito při STAHOVÁNÍ (GET). Tady se stejný princip musí
// použít i při NAHRÁVÁNÍ (POST): viz komentář níže u mergeSyncData.
function unionById<T extends { id: string }>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  for (const x of a) if (x && typeof x.id === "string") map.set(x.id, x);
  for (const x of b) if (x && typeof x.id === "string") map.set(x.id, x);
  return Array.from(map.values());
}

// 🩺 KRITICKÁ POJISTKA PROTI ZTRÁTĚ DAT: appka dřív při KAŽDÉ synchronizaci
// prostě PŘEPSALA celý uložený stav účtu tím, co si zrovna myslí zařízení
// (viz v4.46 story — appka zůstala tiše přihlášená, ale lokální úložiště
// (historie pohádek) se telefonu ztratilo/vymazalo; hned následující
// automatická synchronizace pak poslala PRÁZDNOU historii na server a
// přepsala jí tu poslední zálohu, která tam ještě byla). Appka teď u
// polí, která se v běžném provozu jen ROZŠIŘUJÍ (historie, vlastní postavy,
// vlastní světy), NIKDY nezmenší to, co server už má — jen sloučí (union
// podle id). Menší/prázdné pole ze zařízení tak už nikdy nezničí víc dat,
// než kolik jich samo přineslo. Nastavení/preference (jednoduché hodnoty,
// ne seznamy) se dál jen přebírají z posledního zápisu jako dřív.
function mergeSyncData(existing: unknown, incoming: unknown): unknown {
  const ex = (existing && typeof existing === "object" ? existing : {}) as Record<string, unknown>;
  const inc = (incoming && typeof incoming === "object" ? incoming : {}) as Record<string, unknown>;
  const arr = <T extends { id: string }>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    ...ex,
    ...inc,
    history: unionById(arr(ex.history), arr(inc.history)),
    customChars: unionById(arr(ex.customChars), arr(inc.customChars)),
    customThemes: unionById(arr(ex.customThemes), arr(inc.customThemes)),
  };
}

export async function POST(req: NextRequest) {
  if (!blobToken()) return bad("Účty nejsou nastaveny (chybí Blob úložiště).", 501);
  const username = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!username) return bad("Nepřihlášeno.", 401);
  let body: { data?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("Neplatný požadavek.");
  }
  const json = JSON.stringify(body.data ?? null);
  if (Buffer.byteLength(json, "utf8") > MAX_DATA_BYTES) return bad("Data na sync jsou moc velká.", 413);
  const account = await readAccount(username);
  if (!account) return bad("Účet nenalezen.", 404);
  const merged = mergeSyncData(account.data, body.data ?? null);
  await writeAccount({ ...account, data: merged, updatedAt: Date.now() });
  return NextResponse.json({ ok: true });
}
