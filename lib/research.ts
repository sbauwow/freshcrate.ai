import { unstable_cache } from "next/cache";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { getDbPath } from "@/lib/db-path";

export interface Paper {
  title: string;
  url: string;
  source: string;
  date: string;
  authors?: string;
  abstract?: string;
  is_new?: boolean;
  pwc_url?: string;
}

export interface TrendingModel {
  name: string;
  url: string;
  downloads: number;
  task: string;
  trendingScore?: number;
}

export interface TrendingDataset {
  name: string;
  url: string;
  downloads: number;
}

export interface TrendingSpace {
  name: string;
  url: string;
  sdk: string;
  likes: number;
  trendingScore: number;
}

export interface ResearchSections {
  agentResearch: Paper[];
  llmModels: Paper[];
  machineLearning: Paper[];
  rag: Paper[];
  codeGen: Paper[];
  safety: Paper[];
  benchmarks: Paper[];
  toolUse: Paper[];
}

export interface ResearchSnapshot {
  papers: Paper[];
  categorized_papers: {
    agent_research: Paper[];
    llm_models: Paper[];
    machine_learning: Paper[];
    rag: Paper[];
    code_gen: Paper[];
    safety: Paper[];
    benchmarks: Paper[];
    tool_use: Paper[];
  };
  hf_papers: Paper[];
  trending_models: TrendingModel[];
  trending_datasets: TrendingDataset[];
  trending_spaces: TrendingSpace[];
  fetched_at: string;
}

export interface ResearchSnapshotStore {
  read(): Promise<ResearchSnapshot | null>;
  write(snapshot: ResearchSnapshot): Promise<void>;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit & { next?: { revalidate?: number } }) => Promise<Response>;

type SectionKey = keyof ResearchSections;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ARXIV_REVALIDATE_SECONDS = 3600;
const ARXIV_INTER_REQUEST_DELAY_MS = 3000;
const ARXIV_MAX_ATTEMPTS = 2;
const ARXIV_USER_AGENT = "freshcrate.ai/0.1 (+https://www.freshcrate.ai)";
// Per-request socket cap so a hung upstream can't block the chain unbounded.
const ARXIV_FETCH_TIMEOUT_MS = 8000;
const HF_FETCH_TIMEOUT_MS = 8000;
// Overall build deadline — on exceed we reject and serve the stale snapshot
// instead of letting the serialized arXiv chain run for minutes.
const SNAPSHOT_BUILD_DEADLINE_MS = 15000;

const ARXIV_SECTION_QUERIES: Array<{ key: SectionKey; query: string; max: number }> = [
  { key: "agentResearch", query: "all:agent AND cat:cs.AI", max: 8 },
  { key: "llmModels", query: "cat:cs.CL", max: 8 },
  { key: "machineLearning", query: "cat:cs.LG", max: 6 },
  { key: "rag", query: 'all:"retrieval augmented"', max: 5 },
  {
    key: "codeGen",
    query: '(all:"code generation" OR all:"code synthesis") AND (cat:cs.SE OR cat:cs.AI)',
    max: 5,
  },
  { key: "safety", query: "(all:alignment OR all:safety) AND cat:cs.AI", max: 5 },
  {
    key: "benchmarks",
    query: "(all:benchmark OR all:evaluation) AND (cat:cs.AI OR cat:cs.CL)",
    max: 5,
  },
  { key: "toolUse", query: 'all:"tool use" OR all:"function calling"', max: 5 },
];

function isNew(dateStr: string): boolean {
  return !!dateStr && Date.now() - new Date(dateStr).getTime() < SEVEN_DAYS_MS;
}

function getPwcUrl(arxivUrl: string): string | undefined {
  const match = arxivUrl.match(/arxiv\.org\/abs\/([\d.]+)/);
  return match ? `https://paperswithcode.com/paper/${match[1]}` : undefined;
}

export function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function parseArxivXml(xml: string, source = "arXiv"): Paper[] {
  const entries: Paper[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim() || "";
    const link = entry.match(/<id>(.*?)<\/id>/)?.[1] || "";
    const published = entry.match(/<published>(.*?)<\/published>/)?.[1] || "";
    const authorName = entry.match(/<author>\s*<name>(.*?)<\/name>/)?.[1]?.trim() || "";
    const abstract = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, " ").trim() || "";

    if (title && link) {
      const date = published.slice(0, 10);
      entries.push({
        title: title.slice(0, 150),
        url: link,
        source,
        date,
        authors: authorName ? `${authorName} et al.` : undefined,
        abstract: abstract ? abstract.slice(0, 500) : undefined,
        is_new: isNew(date),
        pwc_url: getPwcUrl(link),
      });
    }
  }
  return entries;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms deadline`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function fetchArxiv(query: string, max: number, fetchImpl: FetchLike = fetch): Promise<Paper[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://export.arxiv.org/api/query?search_query=${encoded}&sortBy=submittedDate&sortOrder=descending&max_results=${max}`;

  for (let attempt = 1; attempt <= ARXIV_MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetchImpl(url, {
        headers: {
          "User-Agent": ARXIV_USER_AGENT,
        },
        signal: AbortSignal.timeout(ARXIV_FETCH_TIMEOUT_MS),
        next: { revalidate: ARXIV_REVALIDATE_SECONDS },
      });

      if (res.ok) {
        return parseArxivXml(await res.text());
      }

      if (res.status !== 429 && res.status < 500) {
        return [];
      }
    } catch {
      // fall through to retry
    }

    if (attempt < ARXIV_MAX_ATTEMPTS) {
      await delay(ARXIV_INTER_REQUEST_DELAY_MS);
    }
  }

  return [];
}

export async function fetchArxivSections(fetchImpl: FetchLike = fetch): Promise<ResearchSections> {
  const sections: ResearchSections = {
    agentResearch: [],
    llmModels: [],
    machineLearning: [],
    rag: [],
    codeGen: [],
    safety: [],
    benchmarks: [],
    toolUse: [],
  };

  for (const [index, section] of ARXIV_SECTION_QUERIES.entries()) {
    sections[section.key] = await fetchArxiv(section.query, section.max, fetchImpl);
    if (index < ARXIV_SECTION_QUERIES.length - 1) {
      await delay(ARXIV_INTER_REQUEST_DELAY_MS);
    }
  }

  return sections;
}

export async function fetchHFPapers(fetchImpl: FetchLike = fetch): Promise<Paper[]> {
  try {
    const res = await fetchImpl("https://huggingface.co/api/daily_papers?limit=10", {
      signal: AbortSignal.timeout(HF_FETCH_TIMEOUT_MS),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data
      .map(
        (item: {
          title?: string;
          paper?: { id?: string; title?: string; authors?: { name?: string }[] };
          publishedAt?: string;
        }) => {
          const date = (item.publishedAt || "").slice(0, 10);
          const arxivId = item.paper?.id || "";
          return {
            title: (item.title || item.paper?.title || "").slice(0, 150),
            url: `https://huggingface.co/papers/${arxivId}`,
            source: "HF Daily",
            date,
            authors: item.paper?.authors?.[0]?.name ? `${item.paper.authors[0].name} et al.` : undefined,
            is_new: isNew(date),
            pwc_url: arxivId ? `https://paperswithcode.com/paper/${arxivId}` : undefined,
          };
        }
      )
      .filter((p: Paper) => p.title);
  } catch {
    return [];
  }
}

export async function fetchHFModels(fetchImpl: FetchLike = fetch): Promise<TrendingModel[]> {
  try {
    const res = await fetchImpl("https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=10", {
      signal: AbortSignal.timeout(HF_FETCH_TIMEOUT_MS),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map(
      (m: { modelId?: string; id?: string; downloads?: number; pipeline_tag?: string; trendingScore?: number }) => ({
        name: m.modelId || m.id || "",
        url: `https://huggingface.co/${m.modelId || m.id}`,
        downloads: m.downloads || 0,
        task: m.pipeline_tag || "",
        trendingScore: m.trendingScore || 0,
      })
    );
  } catch {
    return [];
  }
}

export async function fetchHFDatasets(fetchImpl: FetchLike = fetch): Promise<TrendingDataset[]> {
  try {
    const res = await fetchImpl("https://huggingface.co/api/datasets?sort=trendingScore&direction=-1&limit=8", {
      signal: AbortSignal.timeout(HF_FETCH_TIMEOUT_MS),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((d: { id?: string; downloads?: number }) => ({
      name: d.id || "",
      url: `https://huggingface.co/datasets/${d.id}`,
      downloads: d.downloads || 0,
    }));
  } catch {
    return [];
  }
}

export async function fetchHFSpaces(fetchImpl: FetchLike = fetch): Promise<TrendingSpace[]> {
  try {
    const res = await fetchImpl("https://huggingface.co/api/spaces?sort=trendingScore&direction=-1&limit=10", {
      signal: AbortSignal.timeout(HF_FETCH_TIMEOUT_MS),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((s: { id?: string; sdk?: string; likes?: number; trendingScore?: number }) => ({
      name: s.id || "",
      url: `https://huggingface.co/spaces/${s.id}`,
      sdk: s.sdk || "",
      likes: s.likes || 0,
      trendingScore: s.trendingScore || 0,
    }));
  } catch {
    return [];
  }
}

// Persist next to the SQLite DB so the snapshot lands on the Railway volume
// (prod sets FRESHCRATE_DB_PATH=/data/...) and survives redeploys, instead of
// the ephemeral /app/data image layer that was silently discarded every deploy.
const RESEARCH_SNAPSHOT_PATH = path.join(path.dirname(getDbPath()), "research-snapshot.json");

async function readSnapshotFile(): Promise<ResearchSnapshot | null> {
  try {
    const raw = await readFile(RESEARCH_SNAPSHOT_PATH, "utf8");
    return JSON.parse(raw) as ResearchSnapshot;
  } catch {
    return null;
  }
}

async function writeSnapshotFile(snapshot: ResearchSnapshot): Promise<void> {
  await mkdir(path.dirname(RESEARCH_SNAPSHOT_PATH), { recursive: true });
  await writeFile(RESEARCH_SNAPSHOT_PATH, JSON.stringify(snapshot), "utf8");
}

const fileSnapshotStore: ResearchSnapshotStore = {
  read: readSnapshotFile,
  write: writeSnapshotFile,
};

function snapshotHasContent(s: ResearchSnapshot): boolean {
  return (
    s.papers.length > 0 ||
    s.hf_papers.length > 0 ||
    s.trending_models.length > 0 ||
    s.trending_datasets.length > 0 ||
    s.trending_spaces.length > 0 ||
    s.categorized_papers.agent_research.length > 0 ||
    s.categorized_papers.llm_models.length > 0 ||
    s.categorized_papers.machine_learning.length > 0
  );
}

export async function getResearchSnapshotWithFallback(
  fetchImpl: FetchLike = fetch,
  store: ResearchSnapshotStore = fileSnapshotStore
): Promise<ResearchSnapshot> {
  try {
    const snapshot = await withDeadline(
      buildResearchSnapshot(fetchImpl),
      SNAPSHOT_BUILD_DEADLINE_MS,
      "research snapshot build"
    );
    if (!snapshotHasContent(snapshot)) {
      const stale = await store.read();
      if (stale) {
        return stale;
      }
    }

    await store.write(snapshot);
    return snapshot;
  } catch (error) {
    const stale = await store.read();
    if (stale) {
      return stale;
    }
    throw error;
  }
}

/**
 * Out-of-band refresh: run the full build with the polite serial arXiv pacing
 * and NO request deadline (invoked by the cron route, not user traffic), then
 * persist it so /api/research can serve it fast within its 15s deadline.
 */
export async function refreshResearchSnapshot(
  fetchImpl: FetchLike = fetch,
  store: ResearchSnapshotStore = fileSnapshotStore
): Promise<{ written: boolean; fetched_at: string; counts: Record<string, number> }> {
  const snapshot = await buildResearchSnapshot(fetchImpl);
  const counts = {
    papers: snapshot.papers.length,
    hf_papers: snapshot.hf_papers.length,
    trending_models: snapshot.trending_models.length,
    trending_datasets: snapshot.trending_datasets.length,
    trending_spaces: snapshot.trending_spaces.length,
  };
  if (!snapshotHasContent(snapshot)) {
    return { written: false, fetched_at: snapshot.fetched_at, counts };
  }
  await store.write(snapshot);
  return { written: true, fetched_at: snapshot.fetched_at, counts };
}

export async function buildResearchSnapshot(fetchImpl: FetchLike = fetch): Promise<ResearchSnapshot> {
  const [arxivSections, hfPapers, trendingModels, trendingDatasets, trendingSpaces] = await Promise.all([
    fetchArxivSections(fetchImpl),
    fetchHFPapers(fetchImpl),
    fetchHFModels(fetchImpl),
    fetchHFDatasets(fetchImpl),
    fetchHFSpaces(fetchImpl),
  ]);

  const {
    agentResearch,
    llmModels,
    machineLearning,
    rag,
    codeGen,
    safety,
    benchmarks,
    toolUse,
  } = arxivSections;

  return {
    papers: [...hfPapers, ...agentResearch],
    categorized_papers: {
      agent_research: agentResearch,
      llm_models: llmModels,
      machine_learning: machineLearning,
      rag,
      code_gen: codeGen,
      safety,
      benchmarks,
      tool_use: toolUse,
    },
    hf_papers: hfPapers,
    trending_models: trendingModels,
    trending_datasets: trendingDatasets,
    trending_spaces: trendingSpaces,
    fetched_at: new Date().toISOString(),
  };
}

export const getResearchSnapshot = unstable_cache(
  async () => getResearchSnapshotWithFallback(),
  ["freshcrate-research-snapshot-v1"],
  { revalidate: 3600 }
);
