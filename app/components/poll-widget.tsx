"use client";

import { useState } from "react";
import { track } from "./track";
import type { ActivePoll } from "@/lib/polls";

interface Props {
  poll: ActivePoll;
  initialVotedOption: string | null;
}

export default function PollWidget({ poll, initialVotedOption }: Props) {
  const [state, setState] = useState<{ poll: ActivePoll; voted: string | null; pending: string | null; error: string | null }>({
    poll,
    voted: initialVotedOption,
    pending: null,
    error: null,
  });

  const closed = !!(poll.closesAt && new Date(poll.closesAt).getTime() < Date.now());
  const showResults = closed || !!state.voted;

  async function vote(optionSlug: string) {
    if (state.pending || state.voted) return;
    setState((s) => ({ ...s, pending: optionSlug, error: null }));
    try { track("click", `poll:${optionSlug}@${poll.slug}`); } catch { /* never block */ }
    try {
      const res = await fetch("/api/poll/vote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ poll: poll.slug, option: optionSlug }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setState((s) => ({ ...s, pending: null, error: data?.error || "vote_failed" }));
        return;
      }
      setState({
        poll: data.poll || poll,
        voted: data.votedOption || optionSlug,
        pending: null,
        error: null,
      });
    } catch {
      setState((s) => ({ ...s, pending: null, error: "network" }));
    }
  }

  const total = state.poll.totalVotes || 0;

  return (
    <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3 mb-4">
      <h3 className="text-[11px] font-bold text-fm-green border-b border-fm-border pb-1 mb-2">
        Quick Poll
      </h3>
      <p className="text-[11px] text-fm-text mb-2">{state.poll.question}</p>

      <ul className="space-y-1">
        {state.poll.options.map((o) => {
          const pct = total > 0 ? Math.round((o.votes / total) * 100) : 0;
          const isMine = state.voted === o.slug;
          if (showResults) {
            return (
              <li key={o.id} className="text-[10px]">
                <div className="flex justify-between mb-0.5">
                  <span className={isMine ? "font-bold text-fm-green" : "text-fm-text"}>
                    {isMine ? "✓ " : ""}{o.label}
                  </span>
                  <span className="text-fm-text-light font-mono">
                    {pct}%
                    <span className="text-fm-text-light/70"> ({o.votes})</span>
                  </span>
                </div>
                <div className="h-1.5 bg-fm-border/40 rounded overflow-hidden">
                  <div
                    className={`h-full ${isMine ? "bg-fm-green" : "bg-fm-link/60"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          }
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => vote(o.slug)}
                disabled={!!state.pending}
                className="w-full text-left text-[11px] text-fm-link hover:text-fm-link-hover hover:underline disabled:opacity-60 disabled:cursor-wait"
              >
                {state.pending === o.slug ? "…" : "›"} {o.label}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-2 text-[9px] text-fm-text-light flex justify-between">
        <span>{total.toLocaleString()} vote{total === 1 ? "" : "s"}</span>
        {closed && <span className="font-bold text-fm-text">closed</span>}
        {!closed && state.poll.closesAt && (
          <span>closes {new Date(state.poll.closesAt).toISOString().slice(0, 10)}</span>
        )}
      </div>
      {state.error && (
        <p className="mt-1 text-[9px] text-fm-urgency-high">vote failed: {state.error}</p>
      )}
    </div>
  );
}
