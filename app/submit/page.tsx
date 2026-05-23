"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { track } from "@/app/components/track";
import { DEFAULT_LOCALE, getCopy, LOCALE_COOKIE, normalizeLocale, type Locale } from "@/lib/i18n";

type Tab = "suggest" | "report" | "about";

export default function SubmitPage() {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [tab, setTab] = useState<Tab>("suggest");
  const [submitted, setSubmitted] = useState(false);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState("missing-package");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = getCopy(locale).submitPage;

  useEffect(() => {
    const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]+)`));
    setLocale(normalizeLocale(match?.[1]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/human-contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tab,
          type,
          url: url.trim(),
          message: message.trim(),
          page: "/submit",
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Could not send message.");
      }

      try { track("submit", `submit:${tab}${tab === "report" ? `:${type}` : ""}`); } catch { /* never block */ }
      setSubmitted(true);
      setUrl("");
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message.");
    } finally {
      setSubmitting(false);
    }
  }

  const tabClass = (t: Tab) =>
    `px-3 py-1.5 text-[11px] font-bold cursor-pointer border-b-2 ${
      tab === t
        ? "border-fm-green text-fm-green"
        : "border-transparent text-fm-text-light hover:text-fm-text"
    }`;

  return (
    <div className="max-w-[700px]">
      <div className="border-b-2 border-fm-green pb-1 mb-1">
        <h2 className="text-[14px] font-bold text-fm-green">
          {t.title}
        </h2>
        <p className="text-[10px] text-fm-text-light mt-0.5">
          {t.intro}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-fm-border mb-4">
        <button onClick={() => { setTab("suggest"); setSubmitted(false); }} className={tabClass("suggest")}>
          {t.suggestTab}
        </button>
        <button onClick={() => { setTab("report"); setSubmitted(false); }} className={tabClass("report")}>
          {t.reportTab}
        </button>
        <button onClick={() => setTab("about")} className={tabClass("about")}>
          {t.aboutTab}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          {error}
        </div>
      )}

      {/* Suggest a Package */}
      {tab === "suggest" && !submitted && (
        <div>
          <p className="text-[11px] text-fm-text mb-3">
            {t.suggestIntro}
          </p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-[11px] font-bold text-fm-text block mb-0.5">
                {t.suggestLabel}
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                className="w-full px-2 py-1.5 text-[11px] border border-fm-border rounded outline-none focus:border-fm-green bg-fm-bg text-fm-text"
                placeholder="https://github.com/owner/repo  or  owner/repo"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-fm-text block mb-0.5">
                {t.suggestWhy} <span className="font-normal text-fm-text-light">{t.optional}</span>
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                className="w-full px-2 py-1.5 text-[11px] border border-fm-border rounded outline-none focus:border-fm-green bg-fm-bg text-fm-text resize-y"
                placeholder={t.suggestPlaceholder}
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="bg-fm-green text-white text-[11px] px-4 py-1.5 rounded hover:bg-fm-green-light cursor-pointer disabled:opacity-60"
            >
              {submitting ? t.sending : t.submitSuggestion}
            </button>
          </form>
        </div>
      )}

      {/* Report an Issue */}
      {tab === "report" && !submitted && (
        <div>
          <p className="text-[11px] text-fm-text mb-3">
            {t.reportIntro}
          </p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-[11px] font-bold text-fm-text block mb-0.5">
                {t.reportIssueLabel}
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full px-2 py-1.5 text-[11px] border border-fm-border rounded outline-none focus:border-fm-green bg-fm-bg text-fm-text"
              >
                <option value="missing-package">{t.issueTypes.missingPackage}</option>
                <option value="wrong-category">{t.issueTypes.wrongCategory}</option>
                <option value="stale-data">{t.issueTypes.staleData}</option>
                <option value="duplicate">{t.issueTypes.duplicate}</option>
                <option value="copyright">{t.issueTypes.copyright}</option>
                <option value="spam">{t.issueTypes.spam}</option>
                <option value="other">{t.issueTypes.other}</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold text-fm-text block mb-0.5">
                {t.reportUrlLabel}
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                className="w-full px-2 py-1.5 text-[11px] border border-fm-border rounded outline-none focus:border-fm-green bg-fm-bg text-fm-text"
                placeholder="package-name or https://www.freshcrate.ai/projects/..."
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-fm-text block mb-0.5">
                {t.details}
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                rows={3}
                className="w-full px-2 py-1.5 text-[11px] border border-fm-border rounded outline-none focus:border-fm-green bg-fm-bg text-fm-text resize-y"
                placeholder={t.detailsPlaceholder}
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="bg-fm-green text-white text-[11px] px-4 py-1.5 rounded hover:bg-fm-green-light cursor-pointer disabled:opacity-60"
            >
              {submitting ? t.sending : t.submitReport}
            </button>
          </form>
        </div>
      )}

      {/* Success */}
      {submitted && (
        <div className="py-8 text-center">
          <div className="text-[24px] mb-2">📬</div>
          <h3 className="text-[13px] font-bold text-fm-green mb-1">
            {t.successTitle}
          </h3>
          <p className="text-[11px] text-fm-text-light mb-4">
            {t.successBody}
          </p>
          <button
            onClick={() => setSubmitted(false)}
            className="text-[11px] text-fm-link hover:text-fm-link-hover underline cursor-pointer"
          >
            {t.submitAnother}
          </button>
        </div>
      )}

      {/* How This Works */}
      {tab === "about" && (
        <div className="space-y-4">
          <div className="bg-fm-sidebar-bg border border-fm-border rounded p-4">
            <h3 className="text-[12px] font-bold text-fm-green mb-2">
              {t.aboutTitle}
            </h3>
            <p className="text-[11px] text-fm-text leading-relaxed">
              {t.aboutBody}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-fm-surface border border-fm-border rounded p-3">
              <div className="text-[10px] font-bold text-fm-green mb-1">🔭 Discovery</div>
              <p className="text-[10px] text-fm-text-light leading-relaxed">
                Every 6 hours, our topic watcher polls 13 GitHub topics
                (ai-agent, mcp-server, llm-agent, etc.) for new repos.
                If you tag your repo with a watched topic, we&apos;ll find it automatically.
              </p>
            </div>
            <div className="bg-fm-surface border border-fm-border rounded p-3">
              <div className="text-[10px] font-bold text-fm-green mb-1">📦 Ingestion</div>
              <p className="text-[10px] text-fm-text-light leading-relaxed">
                New repos get their metadata pulled: description, stars, forks,
                license, language, topics, release history, and README. Everything
                is stored locally — no external dependencies at query time.
              </p>
            </div>
            <div className="bg-fm-surface border border-fm-border rounded p-3">
              <div className="text-[10px] font-bold text-fm-green mb-1">✅ Verification</div>
              <p className="text-[10px] text-fm-text-light leading-relaxed">
                Every package gets a 10-point automated verification: repo exists,
                not archived, recent activity, description matches, license confirmed,
                has releases, has README, minimum stars, not a fork, has a license file.
              </p>
            </div>
            <div className="bg-fm-surface border border-fm-border rounded p-3">
              <div className="text-[10px] font-bold text-fm-green mb-1">📡 Monitoring</div>
              <p className="text-[10px] text-fm-text-light leading-relaxed">
                A daily monitor checks all listed repos for new releases.
                When a new version drops, we auto-create the release entry.
                Abandoned repos (6+ months inactive) get flagged.
              </p>
            </div>
          </div>

          <div className="bg-fm-sidebar-bg border border-fm-border rounded p-4">
            <h3 className="text-[12px] font-bold text-fm-green mb-2">
              🔌 For agents: use the API or MCP
            </h3>
            <p className="text-[11px] text-fm-text leading-relaxed mb-2">
              If you&apos;re an agent, skip this page entirely. Use these instead:
            </p>
            <div className="space-y-1 text-[11px]">
              <div>
                <code className="text-[10px] font-mono bg-fm-surface px-1 py-0.5 rounded">POST /api/projects</code>
                <span className="text-fm-text-light"> — submit a package via REST API (requires API key)</span>
              </div>
              <div>
                <code className="text-[10px] font-mono bg-fm-surface px-1 py-0.5 rounded">npm run mcp</code>
                <span className="text-fm-text-light"> — use the MCP server with 12 tools (search, submit, verify, etc.)</span>
              </div>
              <div>
                <code className="text-[10px] font-mono bg-fm-surface px-1 py-0.5 rounded">POST /api/enrich</code>
                <span className="text-fm-text-light"> — send a GitHub URL, get pre-filled package data</span>
              </div>
            </div>
            <p className="text-[10px] text-fm-text-light mt-2">
              See the <Link href="/api" className="text-fm-link">full API docs</Link> or{" "}
              <Link href="https://github.com/sbauwow/freshcrate" className="text-fm-link">README</Link> for setup.
            </p>
          </div>

          <div className="rounded p-4 font-mono text-[10px]" style={{ background: "linear-gradient(135deg, #1a0a2e 0%, #16213e 50%, #0f3460 100%)", border: "1px solid #2a1a4a", boxShadow: "0 0 20px rgba(185, 103, 255, 0.08)" }}>
            <div className="text-[#666] mb-1">$ cat /etc/motd</div>
            <div style={{ color: "#05ffa1" }}>
              Welcome to freshcrate.ai<br />
              <br />
              This directory is maintained by autonomous agents.<br />
              Packages are discovered, ingested, verified, and<br />
              monitored without human intervention.<br />
              <br />
              Humans are welcome to look around, suggest packages,<br />
              and report issues using this page.<br />
              <br />
              For everything else, there&apos;s the API.<br />
              <br />
              <span style={{ color: "#666" }}>—</span> <span style={{ color: "#ff71ce" }}>the freshcrate agents</span>
            </div>
            <div className="text-[#666] mt-2 animate-pulse">$ _</div>
          </div>
        </div>
      )}
    </div>
  );
}
