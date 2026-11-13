import { getDb } from "@/lib/db";
import { CATEGORIES } from "@/lib/categories";
import { ghFetch, parseGithubUrl } from "@/lib/refresh-releases";

export interface SubmissionRow {
  id: number;
  tab: string;
  type: string;
  url: string;
  message: string;
  page: string;
  email_status: string;
  review_status: string;
  reviewed_at: string | null;
  created_at: string;
}

interface GithubRepoMeta {
  html_url?: string;
  description?: string | null;
  owner?: { login?: string };
  license?: { spdx_id?: string | null } | null;
}

type ReviewResult = { ok: true; project?: string } | { ok: false; error: string };

export function listSubmissions(status = "new"): SubmissionRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, tab, type, url, message, page, email_status, review_status, reviewed_at, created_at
       FROM contact_messages WHERE review_status = ? ORDER BY created_at DESC, id DESC`
    )
    .all(status) as SubmissionRow[];
}

function markReviewed(id: number, status: "approved" | "rejected") {
  getDb()
    .prepare("UPDATE contact_messages SET review_status = ?, reviewed_at = datetime('now') WHERE id = ?")
    .run(status, id);
}

function claimNew(id: number): boolean {
  // Atomic claim so two concurrent approvals can't both insert a project.
  const res = getDb()
    .prepare(
      "UPDATE contact_messages SET review_status = 'reviewing', reviewed_at = datetime('now') WHERE id = ? AND review_status = 'new'"
    )
    .run(id);
  return res.changes === 1;
}

export async function approveSuggestion(id: number, category: string): Promise<ReviewResult> {
  const db = getDb();
  const row = db
    .prepare("SELECT id, tab, url, message, review_status FROM contact_messages WHERE id = ?")
    .get(id) as { id: number; tab: string; url: string; message: string; review_status: string } | undefined;

  if (!row) return { ok: false, error: "Submission not found." };
  if (row.review_status !== "new") return { ok: false, error: `Already reviewed (${row.review_status}).` };
  if (row.tab !== "suggest") {
    return { ok: false, error: "Only suggestions can be approved; reports can only be rejected." };
  }
  if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return { ok: false, error: `Unknown category. Must be one of: ${CATEGORIES.join(", ")}` };
  }

  const gh = parseGithubUrl(row.url);
  if (!gh) return { ok: false, error: "Could not parse a GitHub owner/repo out of the URL." };

  const name = gh.repo.toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    return { ok: false, error: `Repo slug "${name}" is not a valid package name.` };
  }

  // Already in the catalog — surface it and let the reviewer decide
  // (they may still want to reject the suggestion outright).
  if (db.prepare("SELECT id FROM projects WHERE name = ?").get(name)) {
    return { ok: false, error: `Already listed as /projects/${name}.` };
  }

  if (!claimNew(id)) return { ok: false, error: "Already reviewed." };

  // Best-effort GitHub metadata; fall back to what the submitter gave us so
  // the catalog entry is never empty just because the API was down.
  let shortDesc = (row.message || "").slice(0, 200) || name;
  let description = "";
  let author = gh.owner;
  let license = "MIT";
  let homepage = `https://github.com/${gh.owner}/${gh.repo}`;

  try {
    const meta = await ghFetch<GithubRepoMeta>(`/repos/${gh.owner}/${gh.repo}`);
    if (meta) {
      if (meta.description) {
        description = meta.description;
        shortDesc = meta.description.slice(0, 200);
      }
      if (meta.owner?.login) author = meta.owner.login;
      if (meta.license?.spdx_id && meta.license.spdx_id !== "NOASSERTION") license = meta.license.spdx_id;
      if (meta.html_url) homepage = meta.html_url;
    }
  } catch {
    // GitHub unreachable — insert with fallback metadata anyway.
  }

  db
    .prepare(
      `INSERT INTO projects (name, short_desc, description, homepage_url, repo_url, license, category, author)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(name, shortDesc, description, homepage, row.url, license, category, author);
  markReviewed(id, "approved");
  return { ok: true, project: name };
}

export function rejectSubmission(id: number): ReviewResult {
  const db = getDb();
  const row = db.prepare("SELECT id, review_status FROM contact_messages WHERE id = ?").get(id) as
    | { id: number; review_status: string }
    | undefined;
  if (!row) return { ok: false, error: "Submission not found." };
  if (row.review_status !== "new") return { ok: false, error: `Already reviewed (${row.review_status}).` };
  markReviewed(id, "rejected");
  return { ok: true };
}
