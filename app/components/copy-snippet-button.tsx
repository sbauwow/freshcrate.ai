"use client";

import { useState } from "react";

export default function CopySnippetButton({
  text,
  copyLabel,
  copiedLabel,
}: {
  text: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copyText}
      className="text-[10px] font-bold text-fm-link hover:text-fm-link-hover"
    >
      {copied ? copiedLabel : copyLabel}
    </button>
  );
}
