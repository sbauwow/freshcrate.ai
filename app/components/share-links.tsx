"use client";

import { useState } from "react";
import { track } from "./track";

interface Props {
  projectName: string;
  shortDesc: string;
}

const BASE = "https://www.freshcrate.ai";

export default function ShareLinks({ projectName, shortDesc }: Props) {
  const [copied, setCopied] = useState(false);
  const url = `${BASE}/projects/${encodeURIComponent(projectName)}`;
  const text = `${projectName} — ${shortDesc} via @freshcrate`;
  const ctx = `@projects/${projectName}`;

  function fire(channel: string) {
    try { track("share", `share:${channel}${ctx}`); } catch { /* never block */ }
  }

  async function copyLink() {
    fire("link");
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("copy this URL", url);
    }
  }

  const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const hnUrl = `https://news.ycombinator.com/submitlink?u=${encodeURIComponent(url)}&t=${encodeURIComponent(projectName)}`;
  const redditUrl = `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(projectName)}`;
  const mailUrl = `mailto:?subject=${encodeURIComponent(projectName)}&body=${encodeURIComponent(`${shortDesc}\n\n${url}`)}`;

  return (
    <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3 mb-4">
      <h3 className="text-[11px] font-bold text-fm-green border-b border-fm-border pb-1 mb-2">
        Share
      </h3>
      <div className="flex flex-wrap gap-2 text-[11px]">
        <button
          type="button"
          onClick={copyLink}
          className="text-fm-link hover:text-fm-link-hover underline"
          title="Copy link to clipboard"
        >
          {copied ? "✓ copied" : "copy link"}
        </button>
        <a
          href={xUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => fire("x")}
          className="text-fm-link hover:text-fm-link-hover"
        >X</a>
        <a
          href={hnUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => fire("hn")}
          className="text-fm-link hover:text-fm-link-hover"
        >HN</a>
        <a
          href={redditUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => fire("reddit")}
          className="text-fm-link hover:text-fm-link-hover"
        >Reddit</a>
        <a
          href={mailUrl}
          onClick={() => fire("email")}
          className="text-fm-link hover:text-fm-link-hover"
        >email</a>
      </div>
    </div>
  );
}
