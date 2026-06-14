export type OrchestraStage = "prototype" | "team" | "production";

export interface OrchestraPattern {
  id: string;
  title: string;
  stage: OrchestraStage;
  themes: string[];
  summary: string;
  why_it_works: string;
  best_practices: string[];
  anti_patterns: string[];
}

export interface OrchestraFilters {
  theme?: string;
  stage?: OrchestraStage;
  q?: string;
}

export interface OrchestraAction {
  id: string;
  title: string;
  priority: "P0" | "P1" | "P2";
  checklist: string[];
}

export interface OrchestraPlaybook {
  score: number;
  level: "low" | "medium" | "high";
  rationale: string;
  actions: OrchestraAction[];
}

const PATTERNS: OrchestraPattern[] = [
  {
    id: "supervisor-worker",
    title: "Supervisor → worker graph",
    stage: "production",
    themes: ["delegation", "supervision", "routing"],
    summary: "Use one planner/supervisor to break work into bounded sub-tasks and route them to narrow workers.",
    why_it_works: "You keep strategy centralized while shrinking the context and permissions each worker needs.",
    best_practices: [
      "Make workers single-purpose: code, research, QA, or deployment — not everything at once.",
      "Pass explicit task contracts with success criteria, budget, and allowed tools.",
      "Require the supervisor to synthesize worker outputs before taking side-effecting actions.",
    ],
    anti_patterns: [
      "Letting every agent talk to every other agent freely.",
      "Giving all workers the full repo and full prompt history by default.",
      "No review gate before write or deploy actions.",
    ],
  },
  {
    id: "review-gated-execution",
    title: "Review-gated execution lane",
    stage: "production",
    themes: ["review", "safety", "deployment"],
    summary: "Separate generation from approval: one agent proposes changes, another checks spec/security, then the executor applies.",
    why_it_works: "It catches shallow reasoning, over-broad edits, and unsafe side effects before they hit prod.",
    best_practices: [
      "Use at least one explicit review gate for schema changes, auth, billing, or deploys.",
      "Review against both product spec and code quality — not just tests passing.",
      "Keep reviewer prompts adversarial: ask what could break, leak, or drift.",
    ],
    anti_patterns: [
      "Same agent writes and rubber-stamps its own work.",
      "Review happening only after merge.",
      "Treating green CI as the only approval signal.",
    ],
  },
  {
    id: "tool-first-grounding",
    title: "Tool-first grounding",
    stage: "team",
    themes: ["observability", "grounding", "tooling"],
    summary: "Make agents inspect live state before deciding: files, logs, DB rows, process state, metrics.",
    why_it_works: "Most orchestration failures come from agents acting on stale assumptions instead of current system state.",
    best_practices: [
      "Require a live read before any irreversible action.",
      "Prefer deterministic tools over memory for versions, counts, and current configs.",
      "Persist structured outputs so downstream agents inherit facts instead of prose guesses.",
    ],
    anti_patterns: [
      "Agents answering from memory for current facts.",
      "Long prompt chains with no system-state refresh.",
      "Passing screenshots or summaries when raw logs are available.",
    ],
  },
  {
    id: "shared-artifact-spine",
    title: "Shared artifact spine",
    stage: "team",
    themes: ["memory", "handoff", "coordination"],
    summary: "Coordinate through explicit artifacts — plans, issue specs, receipts, test outputs, and decision logs.",
    why_it_works: "Artifacts survive context windows and prevent hidden assumptions between agents.",
    best_practices: [
      "Use one canonical task doc per workstream.",
      "Store acceptance criteria next to the artifact, not only in chat.",
      "Log decisions and reversals so later agents know why a path changed.",
    ],
    anti_patterns: [
      "Coordination purely through chat memory.",
      "Multiple diverging TODO lists.",
      "Undocumented manual fixes by human operators.",
    ],
  },
  {
    id: "small-batch-delegation",
    title: "Small-batch delegation",
    stage: "prototype",
    themes: ["delegation", "throughput", "cost"],
    summary: "Start with 2–3 concurrent agents on independent slices, then scale only after measuring merge pain and review load.",
    why_it_works: "Parallelism helps only when synthesis cost stays lower than the work you save.",
    best_practices: [
      "Split by file boundary or concern boundary, not by vague themes.",
      "Cap parallelism until you can measure collision rate.",
      "Always reserve one lane for validation and synthesis.",
    ],
    anti_patterns: [
      "Spawning ten agents into the same surface area.",
      "Parallel agents editing the same auth/config files.",
      "Assuming more agents always means more speed.",
    ],
  },
  {
    id: "human-escalation-thresholds",
    title: "Human escalation thresholds",
    stage: "production",
    themes: ["safety", "ops", "human-in-the-loop"],
    summary: "Define exactly when the orchestra stops and asks a human: production writes, secrets, payments, legal, or ambiguous user intent.",
    why_it_works: "Strong orchestration is not full autonomy — it is clean escalation at the right boundary.",
    best_practices: [
      "Codify escalation triggers instead of relying on agent intuition.",
      "Expose pending approvals in one queue.",
      "Capture the full evidence bundle that caused escalation.",
    ],
    anti_patterns: [
      "Human approval for every trivial step.",
      "No human review for destructive actions.",
      "Escalation with no context, logs, or diff attached.",
    ],
  },
  {
    id: "isolated-workspaces",
    title: "Isolated workspaces for parallel writers",
    stage: "production",
    themes: ["isolation", "delegation", "coordination"],
    summary: "Give each concurrent agent its own sandbox or git worktree so parallel edits can't corrupt shared state, then merge through one gate.",
    why_it_works: "Parallelism only pays off when agents can't clobber each other — isolation turns collisions into explicit, reviewable diffs instead of silent corruption.",
    best_practices: [
      "Run write-capable agents in per-task worktrees or sandboxes, not the live tree.",
      "Reconcile branches through a single synthesis step that owns conflict resolution.",
      "Discard an isolated workspace if its task is abandoned — never half-merge.",
    ],
    anti_patterns: [
      "Multiple agents writing the same working directory at once.",
      "Merging worker output with no conflict-resolution owner.",
      "Sharing one set of credentials or mutable state across isolated lanes.",
    ],
  },
  {
    id: "context-compaction",
    title: "Context compaction for long horizons",
    stage: "team",
    themes: ["context", "memory", "grounding"],
    summary: "For long-running agents, summarize and persist progress before the context window fills, so work survives compaction instead of degrading.",
    why_it_works: "Long tasks outlive any single context window; without deliberate compaction, agents silently drop early decisions and start repeating or contradicting themselves.",
    best_practices: [
      "Checkpoint decisions and open threads to a durable artifact before compacting.",
      "Summarize stale turns into structured state, not free prose.",
      "Re-ground from the artifact after compaction instead of trusting recalled context.",
    ],
    anti_patterns: [
      "Letting the window overflow and hoping the model still remembers.",
      "Compacting history into vague prose that drops acceptance criteria.",
      "Treating summarized memory as authoritative for current system facts.",
    ],
  },
  {
    id: "adversarial-verification",
    title: "Adversarial multi-judge verification",
    stage: "production",
    themes: ["verification", "review", "safety"],
    summary: "For high-stakes output, have several independent agents try to refute a result rather than one reviewer approve it; accept only on consensus.",
    why_it_works: "A single reviewer shares the proposer's blind spots; independent skeptics with distinct lenses catch plausible-but-wrong results that pass one-pass review.",
    best_practices: [
      "Prompt verifiers to refute, not rubber-stamp, and default to reject-if-uncertain.",
      "Give each verifier a distinct lens — correctness, security, does-it-reproduce.",
      "Require majority agreement before a finding or change is trusted.",
    ],
    anti_patterns: [
      "Treating one model's self-check as verification.",
      "Running N identical reviewers instead of diverse lenses.",
      "Confirmation-seeking prompts that nudge reviewers to agree.",
    ],
  },
];

const ACTION_LIBRARY: Record<string, OrchestraAction> = {
  contracts: {
    id: "contracts",
    title: "Introduce task contracts between agents",
    priority: "P0",
    checklist: [
      "Each delegated task includes objective, allowed tools, success criteria, and max budget.",
      "Outputs are structured: result, evidence, unresolved risks.",
      "No worker gets implicit permission to mutate unrelated surfaces.",
    ],
  },
  review: {
    id: "review",
    title: "Add a real review gate before side effects",
    priority: "P0",
    checklist: [
      "Separate proposer and reviewer roles.",
      "Require spec compliance plus code-quality review.",
      "Block deploy/write actions until review passes.",
    ],
  },
  artifacts: {
    id: "artifacts",
    title: "Centralize the artifact spine",
    priority: "P1",
    checklist: [
      "One plan or issue doc per workstream.",
      "Attach tests/logs/receipts to the work item.",
      "Record reversals and operator overrides.",
    ],
  },
  escalation: {
    id: "escalation",
    title: "Codify human escalation boundaries",
    priority: "P1",
    checklist: [
      "List destructive and regulated actions that require human approval.",
      "Bundle evidence with each escalation.",
      "Keep a visible queue of blocked tasks.",
    ],
  },
  grounding: {
    id: "grounding",
    title: "Require tool-grounded reads before action",
    priority: "P0",
    checklist: [
      "Fetch current state before answering or mutating.",
      "Prefer logs, DB rows, and file reads over prompt memory.",
      "Save structured observations for downstream agents.",
    ],
  },
  isolation: {
    id: "isolation",
    title: "Isolate parallel writers",
    priority: "P1",
    checklist: [
      "Run write-capable agents in per-task worktrees or sandboxes.",
      "Merge through one synthesis step that owns conflicts.",
      "Discard abandoned workspaces instead of half-merging.",
    ],
  },
  verification: {
    id: "verification",
    title: "Add adversarial verification for high-stakes output",
    priority: "P1",
    checklist: [
      "Spawn independent skeptics prompted to refute, not approve.",
      "Use distinct lenses: correctness, security, reproducibility.",
      "Accept only on majority agreement.",
    ],
  },
  compaction: {
    id: "compaction",
    title: "Compact context before it overflows",
    priority: "P2",
    checklist: [
      "Checkpoint decisions and open threads to a durable artifact.",
      "Summarize stale turns into structured state, not prose.",
      "Re-ground from the artifact after compaction.",
    ],
  },
};

const THEME_TO_ACTIONS: Record<string, string[]> = {
  delegation: ["contracts", "review"],
  supervision: ["review", "grounding"],
  routing: ["contracts"],
  review: ["review"],
  safety: ["review", "escalation"],
  deployment: ["review", "escalation"],
  observability: ["grounding", "artifacts"],
  grounding: ["grounding"],
  tooling: ["grounding"],
  memory: ["artifacts"],
  handoff: ["artifacts"],
  coordination: ["artifacts", "contracts"],
  throughput: ["contracts"],
  cost: ["contracts"],
  ops: ["escalation", "grounding"],
  "human-in-the-loop": ["escalation"],
  isolation: ["isolation", "review"],
  context: ["compaction", "artifacts"],
  verification: ["verification", "review"],
};

export function getOrchestraPatterns(filters: OrchestraFilters = {}): OrchestraPattern[] {
  const q = filters.q?.trim().toLowerCase();

  return PATTERNS
    .filter((item) => (filters.theme ? item.themes.includes(filters.theme) : true))
    .filter((item) => (filters.stage ? item.stage === filters.stage : true))
    .filter((item) => {
      if (!q) return true;
      const haystack = [item.title, item.summary, item.why_it_works, ...item.themes, ...item.best_practices, ...item.anti_patterns]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function getOrchestraFilterOptions() {
  return {
    themes: Array.from(new Set(PATTERNS.flatMap((item) => item.themes))).sort(),
    stages: Array.from(new Set(PATTERNS.map((item) => item.stage))).sort(),
  };
}

export function getOrchestraBrief() {
  const antiPatterns = PATTERNS.reduce((sum, item) => sum + item.anti_patterns.length, 0);
  // "Principles" = the do-this best-practice items, not just the pattern count.
  const principles = PATTERNS.reduce((sum, item) => sum + item.best_practices.length, 0);
  return {
    principles,
    patterns: PATTERNS.length,
    antiPatterns,
  };
}

export function getOrchestraPlaybook(filters: OrchestraFilters = {}): OrchestraPlaybook {
  const patterns = getOrchestraPatterns(filters);
  const score = Math.max(10, Math.min(100, patterns.length * 16 + (filters.stage === "production" ? 12 : 0) + (filters.theme ? 8 : 0)));
  const level: OrchestraPlaybook["level"] = score >= 60 ? "high" : score >= 35 ? "medium" : "low";

  const actionIds = new Set<string>();
  for (const pattern of patterns) {
    for (const theme of pattern.themes) {
      for (const actionId of THEME_TO_ACTIONS[theme] ?? []) {
        actionIds.add(actionId);
      }
    }
  }
  if (actionIds.size === 0) {
    actionIds.add("contracts");
    actionIds.add("grounding");
  }

  const order: Record<OrchestraAction["priority"], number> = { P0: 0, P1: 1, P2: 2 };
  const actions = Array.from(actionIds)
    .map((id) => ACTION_LIBRARY[id])
    .filter(Boolean)
    .sort((a, b) => order[a.priority] - order[b.priority])
    .slice(0, 5);

  return {
    score,
    level,
    rationale: `${patterns.length} orchestration patterns matched your current scope.`,
    actions,
  };
}
