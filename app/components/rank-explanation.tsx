import type { RankBreakdown } from "@/lib/ranking";

export default function RankExplanation({
  breakdown,
  className = "",
}: {
  breakdown?: RankBreakdown;
  className?: string;
}) {
  if (!breakdown || breakdown.topFactors.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 text-[9px] text-fm-text-light ${className}`.trim()}>
      <span>Why this rank:</span>
      {breakdown.topFactors.map((factor) => (
        <span
          key={factor.key}
          className="bg-fm-green/10 text-fm-green px-1.5 py-0.5 rounded"
          title={`${factor.detail} (+${factor.score})`}
        >
          {factor.label}
        </span>
      ))}
    </div>
  );
}
