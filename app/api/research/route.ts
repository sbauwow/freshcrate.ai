import { NextResponse } from "next/server";
import {
  fetchArxivSections,
  fetchHFDatasets,
  fetchHFModels,
  fetchHFPapers,
  fetchHFSpaces,
  type ResearchSections,
} from "@/lib/research";

const EXTERNAL_FETCH_TIMEOUT_MS = 7000;

type FetchOptions = RequestInit & { next?: { revalidate?: number } };

type FetchLike = (input: string | URL | Request, init?: FetchOptions) => Promise<Response>;

async function fetchWithTimeout(input: string | URL | Request, init?: FetchOptions): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTERNAL_FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

const fetchForApi: FetchLike = (input, init) => fetchWithTimeout(input, init as FetchOptions);

export async function GET() {
  const [arxivSections, hfPapers, trendingModels, trendingDatasets, trendingSpaces] = await Promise.all([
    fetchArxivSections(fetchForApi),
    fetchHFPapers(fetchForApi),
    fetchHFModels(fetchForApi),
    fetchHFDatasets(fetchForApi),
    fetchHFSpaces(fetchForApi),
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
  }: ResearchSections = arxivSections;

  return NextResponse.json({
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
  });
}
