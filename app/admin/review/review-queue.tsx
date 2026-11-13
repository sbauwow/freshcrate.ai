"use client";

import { useCallback, useEffect, useState } from "react";
import { CATEGORIES } from "@/lib/categories";

interface Submission {
  id: number;
  tab: string;
  type: string;
  url: string;
  message: string;
  page: string;
  email_status: string;
  created_at: string;
}

export default function ReviewQueue() {
  const [subs, setSubs] = useState<Submission[] | null>(null);
  const [categories, setCategories] = useState<Record<number, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/review", { cache: "no-store" });
      const data = res.ok ? await res.json() : { submissions: [] };
      setSubs(data.submissions);
    } catch {
      setSubs([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/review", { cache: "no-store" });
        const data = res.ok ? await res.json() : { submissions: [] };
        if (!cancelled) setSubs(data.submissions);
      } catch {
        if (!cancelled) setSubs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function act(id: number, action: "approve" | "reject") {
    setBusyId(id);
    setNote(null);
    try {
      const res = await fetch("/api/admin/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action, category: categories[id] || "AI Agents" }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setNote(data.project ? `Approved → /projects/${data.project}` : "Rejected.");
      } else {
        setNote(data.error || "Action failed.");
      }
    } catch {
      setNote("Action failed.");
    }
    setBusyId(null);
    load();
  }

  return (
    <div className="max-w-[900px]">
      <div className="border-b-2 border-fm-green pb-1 mb-3">
        <h2 className="text-[14px] font-bold text-fm-green">Submission review queue</h2>
        <p className="text-[10px] text-fm-text-light mt-0.5">
          Approving a suggestion fetches GitHub metadata and lists the repo in the catalog; the daily release
          refresh picks it up from there.
        </p>
      </div>

      {note && <div className="mb-3 text-[11px] text-fm-green">{note}</div>}

      {subs === null && <p className="text-[11px] text-fm-text-light">Loading…</p>}

      {subs !== null && subs.length === 0 && (
        <p className="text-[11px] text-fm-text-light">Queue is empty — nothing new to review.</p>
      )}

      {subs !== null &&
        subs.map((s) => (
          <div key={s.id} className="border border-fm-border rounded mb-3 p-3">
            <div className="text-[10px] text-fm-text-light mb-1">
              #{s.id} · {s.tab}
              {s.tab === "report" && s.type ? ` (${s.type})` : ""} · {s.created_at} · email: {s.email_status}
            </div>
            <div className="text-[12px] text-fm-text mb-1 break-all">
              <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                {s.url}
              </a>
            </div>
            {s.message && <div className="text-[11px] text-fm-text-light mb-2 whitespace-pre-wrap">{s.message}</div>}

            {s.tab === "suggest" && (
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-[10px] text-fm-text-light">category</label>
                <select
                  value={categories[s.id] || "AI Agents"}
                  onChange={(e) => setCategories((c) => ({ ...c, [s.id]: e.target.value }))}
                  className="bg-fm-bg border border-fm-border px-1 py-0.5 text-[11px] text-fm-text"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  disabled={busyId === s.id}
                  onClick={() => act(s.id, "approve")}
                  className="px-3 py-1 text-[11px] font-bold border border-fm-border hover:border-fm-green text-fm-green disabled:opacity-50"
                >
                  {busyId === s.id ? "…" : "Approve"}
                </button>
              </div>
            )}

            <button
              disabled={busyId === s.id}
              onClick={() => act(s.id, "reject")}
              className="mt-2 px-3 py-1 text-[11px] border border-fm-border hover:border-fm-urgency-high text-fm-text-light disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        ))}
    </div>
  );
}
