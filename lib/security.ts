import { unstable_cache } from "next/cache";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { getDbPath } from "@/lib/db-path";

export type SecuritySeverity = "critical" | "high" | "medium" | "low" | "unknown";

export interface SecurityCve {
  id: string;
  title: string;
  summary: string;
  severity: SecuritySeverity;
  score: number | null;
  published: string;
  updated: string;
  source: string;
  url: string;
  cwe: string[];
  affected: string[];
  exploited: boolean;
  kevDueDate?: string;
  kevKnownRansomware?: string;
}

export interface SecurityNewsItem {
  title: string;
  url: string;
  source: string;
  published: string;
  summary?: string;
  tags: string[];
}

export interface BreachItem {
  name: string;
  title: string;
  domain: string;
  breachDate: string;
  addedDate: string;
  pwnCount: number;
  dataClasses: string[];
  url: string;
  isVerified: boolean;
}

export interface SecuritySnapshot {
  cves: SecurityCve[];
  exploited: SecurityCve[];
  news: SecurityNewsItem[];
  breaches: BreachItem[];
  summary: {
    critical: number;
    high: number;
    exploited: number;
    breachCount: number;
    newsCount: number;
  };
  sources: Array<{ name: string; url: string }>;
  fetched_at: string;
}

export interface SecuritySnapshotStore {
  read(): Promise<SecuritySnapshot | null>;
  write(snapshot: SecuritySnapshot): Promise<void>;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit & { next?: { revalidate?: number } }) => Promise<Response>;

const SECURITY_FETCH_TIMEOUT_MS = 9000;
const SNAPSHOT_BUILD_DEADLINE_MS = 18000;
const NEWS_REVALIDATE_SECONDS = 1800;
const SECURITY_SNAPSHOT_PATH = path.join(path.dirname(getDbPath()), "security-snapshot.json");

const SOURCES = [
  { name: "NVD CVE API 2.0", url: "https://services.nvd.nist.gov/rest/json/cves/2.0" },
  { name: "CISA Known Exploited Vulnerabilities", url: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json" },
  { name: "Have I Been Pwned breaches", url: "https://haveibeenpwned.com/api/v3/breaches" },
  { name: "BleepingComputer RSS", url: "https://www.bleepingcomputer.com/feed/" },
  { name: "The Hacker News RSS", url: "https://feeds.feedburner.com/TheHackersNews" },
];

function escapeXml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function textBetween(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? escapeXml(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "")) : "";
}

function isoDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function normalizeSeverity(value: string | undefined): SecuritySeverity {
  const v = (value || "").toLowerCase();
  if (v === "critical" || v === "high" || v === "medium" || v === "low") return v;
  return "unknown";
}

function cveMetrics(cve: any): { severity: SecuritySeverity; score: number | null } {
  const metrics = cve.metrics || {};
  const candidates = [
    ...(metrics.cvssMetricV40 || []),
    ...(metrics.cvssMetricV31 || []),
    ...(metrics.cvssMetricV30 || []),
    ...(metrics.cvssMetricV2 || []),
  ];
  const primary = candidates.find((m: any) => m.type === "Primary") || candidates[0];
  const data = primary?.cvssData || {};
  return {
    severity: normalizeSeverity(primary?.baseSeverity || data.baseSeverity),
    score: typeof data.baseScore === "number" ? data.baseScore : null,
  };
}

function cveDescription(cve: any): string {
  const descriptions = cve.descriptions || [];
  return descriptions.find((d: any) => d.lang === "en")?.value || descriptions[0]?.value || "";
}

function cveCwes(cve: any): string[] {
  return (cve.weaknesses || [])
    .flatMap((w: any) => w.description || [])
    .filter((d: any) => d.lang === "en" && d.value)
    .map((d: any) => d.value)
    .slice(0, 4);
}

function cveAffected(cve: any): string[] {
  const names = new Set<string>();
  for (const config of cve.configurations || []) {
    for (const node of config.nodes || []) {
      for (const match of node.cpeMatch || []) {
        const criteria = String(match.criteria || "");
        const parts = criteria.split(":");
        if (parts.length >= 5) names.add(`${parts[3]} ${parts[4]}`.replace(/_/g, " "));
      }
    }
  }
  return Array.from(names).slice(0, 5);
}

function mapNvdCve(item: any, kevIndex: Map<string, any>): SecurityCve | null {
  const cve = item.cve;
  if (!cve?.id) return null;
  const metrics = cveMetrics(cve);
  const summary = cveDescription(cve);
  const kev = kevIndex.get(cve.id);
  return {
    id: cve.id,
    title: cve.id,
    summary: summary.slice(0, 420),
    severity: metrics.severity,
    score: metrics.score,
    published: cve.published || "",
    updated: cve.lastModified || "",
    source: "NVD",
    url: `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve.id)}`,
    cwe: cveCwes(cve),
    affected: cveAffected(cve),
    exploited: !!kev,
    kevDueDate: kev?.dueDate,
    kevKnownRansomware: kev?.knownRansomwareCampaignUse,
  };
}

function mapKevCve(item: any): SecurityCve {
  return {
    id: item.cveID || "",
    title: item.cveID || item.vulnerabilityName || "",
    summary: String(item.shortDescription || item.vulnerabilityName || "").slice(0, 420),
    severity: "unknown",
    score: null,
    published: item.dateAdded || "",
    updated: item.dateAdded || "",
    source: "CISA KEV",
    url: `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(item.cveID || "")}`,
    cwe: [],
    affected: [item.vendorProject, item.product].filter(Boolean).map(String),
    exploited: true,
    kevDueDate: item.dueDate,
    kevKnownRansomware: item.knownRansomwareCampaignUse,
  };
}

async function fetchJson(url: string, fetchImpl: FetchLike): Promise<any | null> {
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": "freshcrate-security/0.1 (+https://www.freshcrate.ai)" },
      signal: AbortSignal.timeout(SECURITY_FETCH_TIMEOUT_MS),
      next: { revalidate: NEWS_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchText(url: string, fetchImpl: FetchLike): Promise<string | null> {
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": "freshcrate-security/0.1 (+https://www.freshcrate.ai)" },
      signal: AbortSignal.timeout(SECURITY_FETCH_TIMEOUT_MS),
      next: { revalidate: NEWS_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

export async function fetchKev(fetchImpl: FetchLike = fetch): Promise<SecurityCve[]> {
  const data = await fetchJson(SOURCES[1].url, fetchImpl);
  const vulns = Array.isArray(data?.vulnerabilities) ? data.vulnerabilities : [];
  return vulns.map(mapKevCve).filter((item: SecurityCve) => item.id).slice(0, 60);
}

export async function fetchRecentCves(fetchImpl: FetchLike = fetch, kev: SecurityCve[] = []): Promise<SecurityCve[]> {
  const end = new Date();
  const start = daysAgo(14);
  const url = `${SOURCES[0].url}?pubStartDate=${encodeURIComponent(isoDate(start))}&pubEndDate=${encodeURIComponent(isoDate(end))}`;
  const data = await fetchJson(url, fetchImpl);
  const kevIndex = new Map(kev.map((item) => [item.id, item]));
  const vulns = Array.isArray(data?.vulnerabilities) ? data.vulnerabilities : [];
  return vulns
    .map((item: any) => mapNvdCve(item, kevIndex))
    .filter(Boolean)
    .filter((item: SecurityCve) => item.exploited || item.severity === "critical" || item.severity === "high")
    .sort((a: SecurityCve, b: SecurityCve) => (b.published || "").localeCompare(a.published || ""))
    .slice(0, 40);
}

export async function fetchBreaches(fetchImpl: FetchLike = fetch): Promise<BreachItem[]> {
  const data = await fetchJson(SOURCES[2].url, fetchImpl);
  if (!Array.isArray(data)) return [];
  return data
    .map((item: any) => ({
      name: String(item.Name || ""),
      title: String(item.Title || item.Name || ""),
      domain: String(item.Domain || ""),
      breachDate: String(item.BreachDate || ""),
      addedDate: String(item.AddedDate || ""),
      pwnCount: Number(item.PwnCount || 0),
      dataClasses: Array.isArray(item.DataClasses) ? item.DataClasses.slice(0, 8).map(String) : [],
      url: item.Domain ? `https://${item.Domain}` : "https://haveibeenpwned.com/PwnedWebsites",
      isVerified: Boolean(item.IsVerified),
    }))
    .filter((item: BreachItem) => item.name)
    .sort((a: BreachItem, b: BreachItem) => (b.addedDate || b.breachDate).localeCompare(a.addedDate || a.breachDate))
    .slice(0, 20);
}

function parseRss(xml: string, source: string): SecurityNewsItem[] {
  const items: SecurityNewsItem[] = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[0];
    const title = textBetween(item, "title");
    const url = textBetween(item, "link");
    const publishedRaw = textBetween(item, "pubDate") || textBetween(item, "dc:date");
    const summary = textBetween(item, "description").slice(0, 260);
    const tags = Array.from(item.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi))
      .map((m) => escapeXml(m[1]))
      .filter(Boolean)
      .slice(0, 5);
    if (title && url) {
      const published = publishedRaw ? new Date(publishedRaw).toISOString() : "";
      items.push({ title: title.slice(0, 180), url, source, published, summary, tags });
    }
  }
  return items;
}

export async function fetchSecurityNews(fetchImpl: FetchLike = fetch): Promise<SecurityNewsItem[]> {
  const feeds = [
    { source: "BleepingComputer", url: SOURCES[3].url },
    { source: "The Hacker News", url: SOURCES[4].url },
  ];
  const chunks = await Promise.all(feeds.map(async (feed) => {
    const xml = await fetchText(feed.url, fetchImpl);
    return xml ? parseRss(xml, feed.source) : [];
  }));
  return chunks
    .flat()
    .sort((a, b) => (b.published || "").localeCompare(a.published || ""))
    .slice(0, 30);
}

function summarize(snapshot: Omit<SecuritySnapshot, "summary">): SecuritySnapshot["summary"] {
  return {
    critical: snapshot.cves.filter((item) => item.severity === "critical").length,
    high: snapshot.cves.filter((item) => item.severity === "high").length,
    exploited: snapshot.exploited.length,
    breachCount: snapshot.breaches.length,
    newsCount: snapshot.news.length,
  };
}

function snapshotHasContent(snapshot: SecuritySnapshot): boolean {
  return snapshot.cves.length > 0 || snapshot.exploited.length > 0 || snapshot.news.length > 0 || snapshot.breaches.length > 0;
}

async function readSnapshotFile(): Promise<SecuritySnapshot | null> {
  try {
    return JSON.parse(await readFile(SECURITY_SNAPSHOT_PATH, "utf8")) as SecuritySnapshot;
  } catch {
    return null;
  }
}

async function writeSnapshotFile(snapshot: SecuritySnapshot): Promise<void> {
  await mkdir(path.dirname(SECURITY_SNAPSHOT_PATH), { recursive: true });
  await writeFile(SECURITY_SNAPSHOT_PATH, JSON.stringify(snapshot), "utf8");
}

const fileSnapshotStore: SecuritySnapshotStore = {
  read: readSnapshotFile,
  write: writeSnapshotFile,
};

function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms deadline`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export async function buildSecuritySnapshot(fetchImpl: FetchLike = fetch): Promise<SecuritySnapshot> {
  const exploited = await fetchKev(fetchImpl);
  const [cves, news, breaches] = await Promise.all([
    fetchRecentCves(fetchImpl, exploited),
    fetchSecurityNews(fetchImpl),
    fetchBreaches(fetchImpl),
  ]);
  const snapshotWithoutSummary = {
    cves,
    exploited: exploited.slice(0, 30),
    news,
    breaches,
    sources: SOURCES,
    fetched_at: new Date().toISOString(),
  };
  return {
    ...snapshotWithoutSummary,
    summary: summarize(snapshotWithoutSummary),
  };
}

export async function getSecuritySnapshotWithFallback(
  fetchImpl: FetchLike = fetch,
  store: SecuritySnapshotStore = fileSnapshotStore,
): Promise<SecuritySnapshot> {
  try {
    const snapshot = await withDeadline(buildSecuritySnapshot(fetchImpl), SNAPSHOT_BUILD_DEADLINE_MS, "security snapshot build");
    if (!snapshotHasContent(snapshot)) {
      const stale = await store.read();
      if (stale) return stale;
    }
    await store.write(snapshot);
    return snapshot;
  } catch (error) {
    const stale = await store.read();
    if (stale) return stale;
    throw error;
  }
}

export async function refreshSecuritySnapshot(
  fetchImpl: FetchLike = fetch,
  store: SecuritySnapshotStore = fileSnapshotStore,
): Promise<{ written: boolean; fetched_at: string; counts: Record<string, number> }> {
  const snapshot = await buildSecuritySnapshot(fetchImpl);
  const counts = {
    cves: snapshot.cves.length,
    exploited: snapshot.exploited.length,
    news: snapshot.news.length,
    breaches: snapshot.breaches.length,
  };
  if (!snapshotHasContent(snapshot)) {
    return { written: false, fetched_at: snapshot.fetched_at, counts };
  }
  await store.write(snapshot);
  return { written: true, fetched_at: snapshot.fetched_at, counts };
}

export const getSecuritySnapshot = unstable_cache(
  async () => {
    const persisted = await fileSnapshotStore.read();
    if (persisted) return persisted;
    return getSecuritySnapshotWithFallback();
  },
  ["freshcrate-security-snapshot-v1"],
  { revalidate: 1800 },
);
