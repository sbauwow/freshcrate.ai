/**
 * Resolve relative links inside rendered README HTML.
 *
 * READMEs arrive with repo-relative hrefs/srcs ("docs/setup.md",
 * "./BENCHMARK.md", "/CONTRIBUTING.md"). Rendered under
 * /projects/<name> those resolve against our origin and 404 — bots then
 * hammer the phantom paths and humans dead-end. Rewrite them to the
 * source repo instead: hrefs → github.com blob URLs, srcs (images) →
 * raw.githubusercontent.com.
 *
 * Non-GitHub repos are left untouched; absolute URLs, protocol-relative
 * URLs, and in-page #anchors always pass through.
 */

const GITHUB_REPO_RE = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i;
const ATTR_RE = /\b(href|src)=(["'])([^"']*)\2/gi;
const PASS_THROUGH_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

export function resolveReadmeLinks(html: string, repoUrl: string | null | undefined): string {
  if (!html) return "";
  const match = (repoUrl || "").match(GITHUB_REPO_RE);
  if (!match) return html;

  const owner = match[1];
  const repo = match[2].replace(/\.git$/, "");
  const blobBase = `https://github.com/${owner}/${repo}/blob/HEAD/`;
  const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/`;

  return html.replace(ATTR_RE, (full, attr: string, quote: string, url: string) => {
    if (!url || PASS_THROUGH_RE.test(url)) return full;
    const path = url.replace(/^\.\//, "").replace(/^\//, "");
    if (!path) return full;
    const base = attr.toLowerCase() === "src" ? rawBase : blobBase;
    return `${attr}=${quote}${base}${path}${quote}`;
  });
}
