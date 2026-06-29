import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

/**
 * Run all pending SQL migrations against the given database.
 * Migrations are read from the `migrations/` directory at project root,
 * sorted by filename. Each is applied inside a transaction and recorded
 * in the `_migrations` tracking table.
 */
export function runMigrations(db: Database.Database): void {
  // Ensure the migrations tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Find migrations directory (try both CWD-relative and __dirname-relative)
  let migrationsDir = path.join(process.cwd(), "migrations");
  if (!fs.existsSync(migrationsDir)) {
    migrationsDir = path.join(__dirname, "..", "migrations");
  }
  if (!fs.existsSync(migrationsDir)) {
    console.log("[migrate] No migrations/ directory found, skipping.");
    return;
  }

  // Read and sort .sql files
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("[migrate] No migration files found.");
    return;
  }

  const isApplied = db.prepare("SELECT 1 FROM _migrations WHERE name = ?");
  let count = 0;

  for (const file of files) {
    // Query per-file so that tracking fixes applied earlier in the loop are seen.
    if (isApplied.get(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");

    const applyMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
    });

    applyMigration();
    count++;
    console.log(`[migrate] Applied: ${file}`);
  }

  if (count === 0) {
    console.log("[migrate] All migrations already applied.");
  } else {
    console.log(`[migrate] Done. Applied ${count} migration(s).`);
  }
}
