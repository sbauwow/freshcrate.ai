#!/usr/bin/env node
/**
 * One-shot: rewrite `projects.author` to drop `<email>` (and similar) so that
 * `/author/<slug>` URLs and sitemap entries no longer leak addresses.
 *
 * Usage: node scripts/clean-authors.mjs                # uses ./freshcrate.db
 *        DATABASE_URL=file:/path/to.db node scripts/clean-authors.mjs
 *        node scripts/clean-authors.mjs --dry          # report only
 */
import Database from "better-sqlite3";
import path from "node:path";

const dbPath = (process.env.DATABASE_URL || "").replace(/^file:/, "")
  || path.resolve(process.cwd(), "freshcrate.db");
const dryRun = process.argv.includes("--dry");

function cleanAuthor(raw) {
  if (!raw) return "";
  let s = String(raw)
    .replace(/<[^>]*>/g, " ")
    .replace(/\([^)]*\)/g, " ");
  s = s.split(",")[0];
  return s.replace(/\s+/g, " ").trim();
}

const db = new Database(dbPath);
const rows = db.prepare("SELECT id, author FROM projects WHERE author IS NOT NULL AND author != ''").all();

const changes = [];
for (const r of rows) {
  const cleaned = cleanAuthor(r.author);
  if (cleaned && cleaned !== r.author) changes.push({ id: r.id, from: r.author, to: cleaned });
}

console.log(`db: ${dbPath}`);
console.log(`scanned: ${rows.length}, would-change: ${changes.length}`);
for (const c of changes.slice(0, 20)) {
  console.log(`  #${c.id}  ${c.from}  →  ${c.to}`);
}
if (changes.length > 20) console.log(`  …(+${changes.length - 20} more)`);

if (dryRun) {
  console.log("dry-run; no writes.");
  process.exit(0);
}

const upd = db.prepare("UPDATE projects SET author = ? WHERE id = ?");
const tx = db.transaction((cs) => { for (const c of cs) upd.run(c.to, c.id); });
tx(changes);
console.log(`updated: ${changes.length}`);
