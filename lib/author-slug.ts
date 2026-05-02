/**
 * npm package metadata frequently embeds emails as `Name <email>` (and sometimes
 * concatenates multiple authors with commas). Storing or routing on those raw
 * strings leaks PII into URLs, logs, and sitemaps.
 *
 * `cleanAuthor` returns just the display name with email parts and trailing
 * separators stripped. `authorMatchesClean` SQL fragment matches a row against
 * a cleaned input regardless of whether the stored row still has the raw form.
 */

/** Strip `<email>` and any trailing separators; trim whitespace. */
export function cleanAuthor(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw);
  // Drop `<...>` (emails or URLs)
  s = s.replace(/<[^>]*>/g, " ");
  // Drop `(...)` (homepages, descriptors)
  s = s.replace(/\([^)]*\)/g, " ");
  // Take first author if comma-separated
  s = s.split(",")[0];
  // Collapse whitespace, trim
  return s.replace(/\s+/g, " ").trim();
}

/**
 * SQL expression that returns the cleaned author for a given column reference,
 * mirroring `cleanAuthor` for the `<email>` case (the dominant form in the data).
 * Use as: `WHERE ${authorCleanSql("p.author")} = ?`
 */
export function authorCleanSql(column: string): string {
  return `TRIM(CASE WHEN INSTR(${column}, '<') > 0 THEN SUBSTR(${column}, 1, INSTR(${column}, '<') - 1) ELSE ${column} END)`;
}
