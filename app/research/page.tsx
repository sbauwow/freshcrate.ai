import Link from "next/link";
import type { Metadata } from "next";
import {
  fetchArxivSections,
  fetchHFDatasets,
  fetchHFModels,
  fetchHFPapers,
  fetchHFSpaces,
  formatDownloads,
  type Paper,
  type TrendingDataset,
  type TrendingModel,
  type TrendingSpace,
} from "@/lib/research";

export const metadata: Metadata = {
  title: "freshcrate research — Latest AI Agent Papers & Models",
  description: "Live AI agent research from arXiv and HuggingFace. Papers, models, datasets, spaces, benchmarks.",
};

export const dynamic = "force-dynamic";

// — Section components —

function NewBadge() {
  return (
    <span className="text-[8px] font-bold px-1 py-0 rounded bg-green-100 text-green-700 uppercase tracking-wide shrink-0">
      new
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  const colors =
    source === "HF Daily"
      ? "bg-yellow-100 text-yellow-700"
      : source === "arXiv"
      ? "bg-red-50 text-red-600"
      : "bg-blue-50 text-blue-600";
  return <span className={`text-[9px] px-1 py-0 rounded font-bold shrink-0 ${colors}`}>{source}</span>;
}

function PaperList({ papers, fallback }: { papers: Paper[]; fallback: string }) {
  if (!papers.length)
    return <div className="text-[10px] text-fm-text-light italic">{fallback}</div>;
  return (
    <ul className="space-y-2.5">
      {papers.map((p, i) => (
        <li key={i}>
          <div className="flex items-start gap-1.5">
            {p.is_new && <NewBadge />}
            <a
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-fm-link hover:underline text-[11px] leading-tight"
            >
              {p.title}
            </a>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <SourceBadge source={p.source} />
            {p.authors && (
              <span className="text-[9px] text-fm-text-light truncate max-w-[180px]">
                {p.authors}
              </span>
            )}
            {p.pwc_url && (
              <a
                href={p.pwc_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] text-blue-500 hover:underline font-bold"
                title="Papers With Code"
              >
                PwC
              </a>
            )}
            <span className="text-[9px] text-fm-text-light ml-auto">{p.date}</span>
          </div>
          {p.abstract && (
            <details className="mt-1">
              <summary className="text-[9px] text-fm-link cursor-pointer select-none hover:underline">
                abstract
              </summary>
              <p className="text-[9px] text-fm-text-light mt-1 leading-relaxed border-l-2 border-fm-border pl-2">
                {p.abstract}{p.abstract.length >= 500 ? "…" : ""}
              </p>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

function ModelList({ models }: { models: TrendingModel[] }) {
  if (!models.length)
    return <div className="text-[10px] text-fm-text-light italic">Could not load models.</div>;
  return (
    <ul className="space-y-1.5">
      {models.map((m, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <span className="text-[9px] text-fm-text-light mt-0.5 shrink-0 w-[14px] text-right">
            {i + 1}.
          </span>
          <div className="min-w-0 flex-1">
            <a
              href={m.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-fm-link hover:underline text-[11px] leading-tight block truncate"
              title={m.name}
            >
              {m.name}
            </a>
            <div className="flex items-center gap-2 text-[9px] text-fm-text-light flex-wrap">
              {m.task && (
                <span className="bg-blue-50 text-blue-600 px-1 rounded font-bold">{m.task}</span>
              )}
              <span>{formatDownloads(m.downloads)} dl</span>
              {m.trendingScore != null && m.trendingScore > 0 && (
                <span className="text-green-600 font-bold">↑{m.trendingScore}</span>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function DatasetList({ datasets }: { datasets: TrendingDataset[] }) {
  if (!datasets.length)
    return <div className="text-[10px] text-fm-text-light italic">Could not load datasets.</div>;
  return (
    <ul className="space-y-1.5">
      {datasets.map((d, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <span className="text-[9px] text-fm-text-light mt-0.5 shrink-0 w-[14px] text-right">
            {i + 1}.
          </span>
          <div className="min-w-0 flex-1">
            <a
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-fm-link hover:underline text-[11px] leading-tight block truncate"
              title={d.name}
            >
              {d.name}
            </a>
            <div className="text-[9px] text-fm-text-light">
              <span className="bg-purple-50 text-purple-600 px-1 rounded font-bold">dataset</span>{" "}
              {formatDownloads(d.downloads)} dl
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function SpacesList({ spaces }: { spaces: TrendingSpace[] }) {
  if (!spaces.length)
    return <div className="text-[10px] text-fm-text-light italic">Could not load spaces.</div>;

  const sdkColor: Record<string, string> = {
    gradio: "bg-orange-50 text-orange-600",
    streamlit: "bg-red-50 text-red-600",
    docker: "bg-blue-50 text-blue-600",
    static: "bg-gray-100 text-gray-600",
  };

  return (
    <ul className="space-y-1.5">
      {spaces.map((s, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <span className="text-[9px] text-fm-text-light mt-0.5 shrink-0 w-[14px] text-right">
            {i + 1}.
          </span>
          <div className="min-w-0 flex-1">
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-fm-link hover:underline text-[11px] leading-tight block truncate"
              title={s.name}
            >
              {s.name}
            </a>
            <div className="flex items-center gap-2 text-[9px] text-fm-text-light">
              {s.sdk && (
                <span className={`px-1 rounded font-bold ${sdkColor[s.sdk] || "bg-gray-100 text-gray-600"}`}>
                  {s.sdk}
                </span>
              )}
              <span>♥ {formatDownloads(s.likes)}</span>
              {s.trendingScore > 0 && (
                <span className="text-green-600 font-bold">↑{s.trendingScore}</span>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function SectionBox({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="mb-4">
      <h3 className="text-[12px] font-bold text-[#6f6f6f] border-b-2 border-[#6f6f6f] pb-1 mb-2 uppercase tracking-wide">
        {title}
      </h3>
      {children}
    </div>
  );
}

// — Jump links config —

const JUMP_LINKS = [
  { id: "agent-research", label: "agents" },
  { id: "llm-models", label: "llm" },
  { id: "machine-learning", label: "ml" },
  { id: "rag", label: "rag" },
  { id: "code-gen", label: "code" },
  { id: "safety", label: "safety" },
  { id: "hf-papers", label: "hf papers" },
  { id: "trending-models", label: "models" },
  { id: "spaces", label: "spaces" },
  { id: "datasets", label: "datasets" },
  { id: "benchmarks", label: "benchmarks" },
  { id: "tool-use", label: "tool use" },
];

// — Page —

export default async function ResearchPage() {
  const [arxivSections, hfPapers, trendingModels, trendingDatasets, trendingSpaces] = await Promise.all([
    fetchArxivSections(),
    fetchHFPapers(),
    fetchHFModels(),
    fetchHFDatasets(),
    fetchHFSpaces(),
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

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-[14px] font-bold text-fm-text">
          freshcrate research — Latest AI Agent Papers &amp; Models
        </h1>
        <p className="text-[10px] text-fm-text-light mt-0.5">
          Live from arXiv and HuggingFace. Cached 1 hour.{" "}
          <span className="inline-flex items-center gap-1">
            <span className="text-[8px] font-bold px-1 py-0 rounded bg-green-100 text-green-700 uppercase">new</span>
            = published within 7 days.
          </span>{" "}
          Abstract links expand inline. PwC = Papers With Code.
        </p>
      </div>

      {/* Jump links */}
      <div className="bg-[#f0f0f0] border border-fm-border px-3 py-1.5 mb-4 text-[10px]">
        <span className="font-bold text-fm-text mr-1">Jump to:</span>
        {JUMP_LINKS.map((link, i) => (
          <span key={link.id}>
            {i > 0 && <span className="text-[#999] mx-1">|</span>}
            <a href={`#${link.id}`} className="text-fm-link hover:underline">
              {link.label}
            </a>
          </span>
        ))}
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-0">
        {/* COLUMN 1 */}
        <div>
          <SectionBox id="agent-research" title="Agent Research">
            <PaperList papers={agentResearch} fallback="Could not load agent research papers." />
          </SectionBox>

          <SectionBox id="llm-models" title="LLM & Foundation Models">
            <PaperList papers={llmModels} fallback="Could not load LLM papers." />
          </SectionBox>

          <SectionBox id="machine-learning" title="Machine Learning (cs.LG)">
            <PaperList papers={machineLearning} fallback="Could not load ML papers." />
          </SectionBox>

          <SectionBox id="rag" title="Retrieval & RAG">
            <PaperList papers={rag} fallback="Could not load RAG papers." />
          </SectionBox>

          <SectionBox id="code-gen" title="Code Generation">
            <PaperList papers={codeGen} fallback="Could not load code generation papers." />
          </SectionBox>

          <SectionBox id="safety" title="Safety & Alignment">
            <PaperList papers={safety} fallback="Could not load safety papers." />
          </SectionBox>
        </div>

        {/* COLUMN 2 */}
        <div>
          <SectionBox id="hf-papers" title="HuggingFace Daily Papers">
            <PaperList papers={hfPapers} fallback="Could not load HuggingFace papers." />
          </SectionBox>

          <SectionBox id="trending-models" title="Trending Models">
            <ModelList models={trendingModels} />
          </SectionBox>

          <SectionBox id="spaces" title="Trending Spaces">
            <SpacesList spaces={trendingSpaces} />
          </SectionBox>

          <SectionBox id="datasets" title="Trending Datasets">
            <DatasetList datasets={trendingDatasets} />
          </SectionBox>

          <SectionBox id="benchmarks" title="Benchmarks & Evals">
            <PaperList papers={benchmarks} fallback="Could not load benchmark papers." />
          </SectionBox>

          <SectionBox id="tool-use" title="Tool Use & MCP">
            <PaperList papers={toolUse} fallback="Could not load tool use papers." />
          </SectionBox>
        </div>
      </div>

      {/* Footer note */}
      <div className="text-[9px] text-fm-text-light mt-4 border-t border-fm-border pt-2">
        Data fetched server-side from{" "}
        <a href="https://arxiv.org" className="text-fm-link hover:underline" target="_blank" rel="noopener noreferrer">arXiv</a>
        ,{" "}
        <a href="https://huggingface.co" className="text-fm-link hover:underline" target="_blank" rel="noopener noreferrer">HuggingFace</a>
        , and{" "}
        <a href="https://paperswithcode.com" className="text-fm-link hover:underline" target="_blank" rel="noopener noreferrer">Papers With Code</a>
        . Cached 1 hour.{" "}
        <Link href="/api/research" className="text-fm-link hover:underline">Raw JSON →</Link>
      </div>
    </div>
  );
}
