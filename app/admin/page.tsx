"use client";
// 🛠️ Developerský přehled účtů — kdo appku používá, kolik kreditů a
// dokončených pohádek. Heslo se drží jen v paměti (state), nikde neukládá.
// Chráněno ADMIN_PASSWORD na serveru (viz /api/admin/accounts).

import { useState } from "react";

interface AdminAccount {
  username: string;
  email?: string;
  credits?: number;
  storiesCompleted?: number;
  createdAt: number;
  updatedAt?: number;
}

function fmt(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("cs-CZ");
}

export default function AdminPage() {
  const [pw, setPw] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(password: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/accounts", { headers: { "X-Admin-Password": password } });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "Chyba.");
        return;
      }
      setAccounts(d.accounts);
      setUnlocked(true);
    } catch {
      setError("Nepodařilo se načíst — zkuste to znovu.");
    } finally {
      setBusy(false);
    }
  }

  if (!unlocked) {
    return (
      <div style={{ maxWidth: 360, margin: "80px auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 20, marginBottom: 16 }}>🛠️ Developerský přehled</h1>
        <input
          type="password"
          value={pw}
          onChange={e => setPw(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && pw) load(pw); }}
          placeholder="Admin heslo"
          style={{ width: "100%", padding: 10, fontSize: 16, boxSizing: "border-box" }}
        />
        <button
          onClick={() => load(pw)}
          disabled={!pw || busy}
          style={{ width: "100%", padding: 10, marginTop: 10, fontSize: 16, cursor: "pointer" }}
        >
          {busy ? "…" : "Odemknout"}
        </button>
        {error && <p style={{ color: "#c0392b", marginTop: 10 }}>{error}</p>}
      </div>
    );
  }

  const total = accounts?.length ?? 0;
  const totalCredits = accounts?.reduce((s, a) => s + (a.credits ?? 0), 0) ?? 0;
  const totalStories = accounts?.reduce((s, a) => s + (a.storiesCompleted ?? 0), 0) ?? 0;

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>🛠️ Developerský přehled účtů</h1>
      <p style={{ color: "#666", marginBottom: 20 }}>
        {total} účtů · {totalCredits} kreditů zbývá celkem · {totalStories} dokončených pohádek celkem
      </p>
      <button onClick={() => load(pw)} disabled={busy} style={{ marginBottom: 16, padding: "6px 14px", cursor: "pointer" }}>
        {busy ? "Načítám…" : "🔄 Obnovit"}
      </button>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
              <th style={{ padding: 8 }}>Jméno</th>
              <th style={{ padding: 8 }}>E-mail</th>
              <th style={{ padding: 8 }}>Kredity</th>
              <th style={{ padding: 8 }}>Pohádek</th>
              <th style={{ padding: 8 }}>Založeno</th>
              <th style={{ padding: 8 }}>Poslední aktivita</th>
            </tr>
          </thead>
          <tbody>
            {accounts?.map(a => (
              <tr key={a.username} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: 8 }}>{a.username}</td>
                <td style={{ padding: 8 }}>{a.email || "—"}</td>
                <td style={{ padding: 8 }}>💳 {a.credits ?? 0}</td>
                <td style={{ padding: 8 }}>{a.storiesCompleted ?? 0}</td>
                <td style={{ padding: 8 }}>{fmt(a.createdAt)}</td>
                <td style={{ padding: 8 }}>{fmt(a.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
