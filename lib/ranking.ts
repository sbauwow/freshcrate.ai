import type { ProjectWithRelease } from "@/lib/queries";

export type RankFactorKey = "verification" | "recency" | "adoption" | "cadence" | "query";

export interface RankFactor {
  key: RankFactorKey;
  label: string;
  score: number;
  detail: string;
}

export interface RankBreakdown {
  total: number;
  factors: RankFactor[];
  topFactors: RankFactor[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}

function daysSince(input?: string | null): number {
  if (!input) return 9999;
  const ts = new Date(input).getTime();
  if (Number.isNaN(ts)) return 9999;
  return Math.max(0, (Date.now() - ts) / (1000 * 60 * 60 * 24));
}

function parseJsonObject(raw?: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function countQueryHits(project: ProjectWithRelease, query?: string): number {
  if (!query) return 0;
  const haystacks = [
    project.name,
    project.short_desc,
    project.description,
    ...(project.tags || []),
  ]
    .join(" ")
    .toLowerCase();

  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .reduce((sum, token) => sum + (haystacks.includes(token) ? 1 : 0), 0);
}

export function isRankingV2Enabled(): boolean {
  const raw = (process.env.FRESHCRATE_RANKING_V2 || "1").toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export function getProjectRankBreakdown(project: ProjectWithRelease, query?: string): RankBreakdown {
  const verification = parseJsonObject(project.verification_json);
  const verificationScore = Number(verification.score || 0);

  const releaseDays = daysSince(project.release_date);
  const createdDays = Math.max(1, daysSince(project.created_at));
  const releaseCount = Number(project.release_count || 1);
  const stars = Number(project.stars || 0);
  const forks = Number(project.forks || 0);
  const queryHits = countQueryHits(project, query);

  const factors: RankFactor[] = [
    {
      key: "verification",
      label: project.verified ? "Verified & scored" : "Package trust signals",
      score: roundScore((project.verified ? 18 : 0) + clamp(verificationScore / 6, 0, 16)),
      detail: project.verified
        ? `Verified package with verification score ${verificationScore || 0}`
        : "Unverified package with limited trust boost",
    },
    {
      key: "recency",
      label: releaseDays <= 30 ? "Recent release" : "Release freshness",
      score: roundScore(clamp(24 - releaseDays / 14, -12, 24)),
      detail: `Latest release ${Math.round(releaseDays)} days ago`,
    },
    {
      key: "adoption",
      label: "Strong adoption",
      score: roundScore(
        clamp(
          Math.log1p(stars) * 4 + Math.log1p(forks) * 2 + Math.log1p(((stars + forks * 2) / createdDays) * 30) * 4,
          0,
          28
        )
      ),
      detail: `${stars} stars and ${forks} forks`,
    },
    {
      key: "cadence",
      label: "Healthy release cadence",
      score: roundScore(clamp(releaseCount * 2.5 + (releaseDays <= 30 ? 4 : 0), 0, 16)),
      detail: `${releaseCount} releases tracked`,
    },
    {
      key: "query",
      label: "Matches your search",
      score: roundScore(clamp(queryHits * 3, 0, 12)),
      detail: queryHits > 0 ? `${queryHits} query term hits` : "No direct query boost",
    },
  ];

  const total = roundScore(factors.reduce((sum, factor) => sum + factor.score, 0));
  const topFactors = [...factors]
    .filter((factor) => factor.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 3);

  return { total, factors, topFactors };
}

export function scoreProjectRankingV2(project: ProjectWithRelease, query?: string): number {
  return getProjectRankBreakdown(project, query).total;
}

export function attachRankBreakdown<T extends ProjectWithRelease>(project: T, query?: string): T & { rank_breakdown: RankBreakdown } {
  return {
    ...project,
    rank_breakdown: getProjectRankBreakdown(project, query),
  };
}

export function rankProjectsV2(projects: ProjectWithRelease[], query?: string): (ProjectWithRelease & { rank_breakdown: RankBreakdown })[] {
  const scoredProjects = projects.map((project) => attachRankBreakdown(project, query));

  return scoredProjects.sort((a, b) => {
    const scoreDelta = b.rank_breakdown.total - a.rank_breakdown.total;
    if (scoreDelta !== 0) return scoreDelta;

    const verifiedDelta = Number(b.verified || 0) - Number(a.verified || 0);
    if (verifiedDelta !== 0) return verifiedDelta;

    const starsDelta = Number(b.stars || 0) - Number(a.stars || 0);
    if (starsDelta !== 0) return starsDelta;

    const releaseDelta = new Date(b.release_date).getTime() - new Date(a.release_date).getTime();
    if (releaseDelta !== 0) return releaseDelta;

    return a.name.localeCompare(b.name);
  });
}
