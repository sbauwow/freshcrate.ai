import crypto from "crypto";
import { getDb } from "./db";

/**
 * Single-active poll widget. Curated, not crowdsourced — the active poll is
 * defined here in `ACTIVE_POLL` and rotated by editing this file. Only votes
 * accumulate in the DB. To rotate: change the slug, question, and options;
 * the next request will deactivate any prior active poll and seed the new one.
 *
 * Vote dedupe is per fc_sid session cookie, falling back to a daily-rotated IP
 * hash so a missing cookie still constrains ballot stuffing to one per IP/day.
 */

interface SeedOption { slug: string; label: string }
interface SeedPoll { slug: string; question: string; options: SeedOption[]; closesAt?: string }

export const ACTIVE_POLL: SeedPoll = {
  slug: "agent-runtime-2026-q2",
  question: "Which agent runtime do you ship with?",
  options: [
    { slug: "claude-agent-sdk", label: "Claude Agent SDK" },
    { slug: "openai-agents-sdk", label: "OpenAI Agents SDK" },
    { slug: "langgraph", label: "LangGraph" },
    { slug: "custom", label: "Rolled my own" },
    { slug: "none", label: "Not running agents in prod yet" },
  ],
  closesAt: "2026-06-01T00:00:00Z",
};

export interface PollOptionRow { id: number; slug: string; label: string; position: number; votes: number }
export interface ActivePoll {
  id: number;
  slug: string;
  question: string;
  closesAt: string | null;
  options: PollOptionRow[];
  totalVotes: number;
}

function hashIpDaily(ip: string): string {
  if (!ip) return "";
  const salt = "freshcrate-poll-" + new Date().toISOString().slice(0, 10);
  return crypto.createHash("sha256").update(salt + ip).digest("hex").slice(0, 16);
}

/** Idempotently make sure ACTIVE_POLL is in the DB and is the only active one. */
function ensureSeeded(): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("UPDATE polls SET active = 0 WHERE slug != ?").run(ACTIVE_POLL.slug);
    const existing = db.prepare("SELECT id FROM polls WHERE slug = ?").get(ACTIVE_POLL.slug) as { id: number } | undefined;
    if (!existing) {
      const r = db.prepare("INSERT INTO polls (slug, question, active, closes_at) VALUES (?, ?, 1, ?)").run(
        ACTIVE_POLL.slug,
        ACTIVE_POLL.question,
        ACTIVE_POLL.closesAt ?? null,
      );
      const pollId = r.lastInsertRowid as number;
      const insertOpt = db.prepare("INSERT INTO poll_options (poll_id, slug, label, position) VALUES (?, ?, ?, ?)");
      ACTIVE_POLL.options.forEach((o, i) => insertOpt.run(pollId, o.slug, o.label, i));
    } else {
      db.prepare("UPDATE polls SET active = 1, question = ?, closes_at = ? WHERE id = ?").run(
        ACTIVE_POLL.question,
        ACTIVE_POLL.closesAt ?? null,
        existing.id,
      );
    }
  });
  tx();
}

export function getActivePoll(): ActivePoll | null {
  ensureSeeded();
  const db = getDb();
  const poll = db.prepare("SELECT id, slug, question, closes_at FROM polls WHERE active = 1 LIMIT 1").get() as
    | { id: number; slug: string; question: string; closes_at: string | null }
    | undefined;
  if (!poll) return null;

  const options = db.prepare(`
    SELECT o.id, o.slug, o.label, o.position,
           COALESCE((SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id), 0) AS votes
    FROM poll_options o
    WHERE o.poll_id = ?
    ORDER BY o.position
  `).all(poll.id) as PollOptionRow[];

  const totalVotes = options.reduce((sum, o) => sum + o.votes, 0);
  return { id: poll.id, slug: poll.slug, question: poll.question, closesAt: poll.closes_at, options, totalVotes };
}

export interface VoteResult {
  ok: boolean;
  alreadyVoted?: boolean;
  votedOption?: string;
  poll: ActivePoll | null;
  error?: string;
}

/** Returns the user's existing vote for a poll, if any. */
export function getExistingVote(pollId: number, sessionId: string, ip: string): string | null {
  if (!sessionId && !ip) return null;
  const db = getDb();
  const ipHash = hashIpDaily(ip);
  const row = db.prepare(`
    SELECT o.slug AS slug
    FROM poll_votes v
    JOIN poll_options o ON o.id = v.option_id
    WHERE v.poll_id = ?
      AND ((? <> '' AND v.session_id = ?) OR (? <> '' AND v.ip_hash = ?))
    LIMIT 1
  `).get(pollId, sessionId, sessionId, ipHash, ipHash) as { slug: string } | undefined;
  return row?.slug ?? null;
}

export function recordVote(pollSlug: string, optionSlug: string, sessionId: string, ip: string): VoteResult {
  const poll = getActivePoll();
  if (!poll || poll.slug !== pollSlug) return { ok: false, poll, error: "no_active_poll" };
  if (poll.closesAt && new Date(poll.closesAt).getTime() < Date.now()) return { ok: false, poll, error: "poll_closed" };

  const option = poll.options.find((o) => o.slug === optionSlug);
  if (!option) return { ok: false, poll, error: "unknown_option" };

  const existing = getExistingVote(poll.id, sessionId, ip);
  if (existing) {
    return { ok: true, alreadyVoted: true, votedOption: existing, poll: getActivePoll() };
  }

  const db = getDb();
  const ipHash = hashIpDaily(ip);
  try {
    db.prepare("INSERT INTO poll_votes (poll_id, option_id, session_id, ip_hash) VALUES (?, ?, ?, ?)")
      .run(poll.id, option.id, sessionId || "", ipHash);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      return { ok: true, alreadyVoted: true, votedOption: existing ?? optionSlug, poll: getActivePoll() };
    }
    throw e;
  }
  return { ok: true, alreadyVoted: false, votedOption: optionSlug, poll: getActivePoll() };
}
