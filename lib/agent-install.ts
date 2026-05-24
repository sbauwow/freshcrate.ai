import type { MCPManifest } from "@/lib/mcp";
import { MCP_LABELS } from "@/lib/mcp";
import type { ProjectWithRelease } from "@/lib/queries";
import type { VerificationResult } from "@/lib/verify";

export interface AgentInstallInfo {
  installCommand: string;
  configSnippet: string | null;
  runtimeRequirements: string[];
  authNotes: string[];
  verifiedDate: string | null;
  sourceLabel: string;
}

function packageId(project: ProjectWithRelease): string {
  return project.source_package_id || project.name;
}

function mcpRuntime(mcp: MCPManifest | null): string[] {
  return Array.isArray(mcp?.runtime) ? mcp.runtime : [];
}

function mcpAuth(mcp: MCPManifest | null): string[] {
  return Array.isArray(mcp?.auth) ? mcp.auth : [];
}

function isNpmProject(project: ProjectWithRelease, mcp: MCPManifest | null): boolean {
  return (project.source_type || "").toLowerCase() === "npm" || mcpRuntime(mcp).includes("npx") || packageId(project).startsWith("@");
}

function isPythonProject(project: ProjectWithRelease, mcp: MCPManifest | null): boolean {
  const source = (project.source_type || "").toLowerCase();
  const language = (project.language || "").toLowerCase();
  return source === "pypi" || language === "python" || mcpRuntime(mcp).some((r) => r === "pip" || r === "uvx");
}

function isRustProject(project: ProjectWithRelease, mcp: MCPManifest | null): boolean {
  return (project.language || "").toLowerCase() === "rust" || mcpRuntime(mcp).includes("cargo");
}

function isGoProject(project: ProjectWithRelease, mcp: MCPManifest | null): boolean {
  return (project.language || "").toLowerCase() === "go" || mcpRuntime(mcp).includes("go-install");
}

function installCommand(project: ProjectWithRelease, mcp: MCPManifest | null): string {
  const id = packageId(project);
  if (isNpmProject(project, mcp)) return `npm install ${id}`;
  if (isPythonProject(project, mcp)) return `uv add ${id}\n# or: pip install ${id}`;
  if (isRustProject(project, mcp)) return `cargo install ${id}`;
  if (isGoProject(project, mcp)) {
    const target = project.repo_url ? project.repo_url.replace(/^https:\/\/github\.com\//, "github.com/") : id;
    return `go install ${target}@latest`;
  }
  if (project.repo_url) return `git clone ${project.repo_url}`;
  return `# See ${project.homepage_url || project.source_url || project.name} for install instructions`;
}

function serverKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "freshcrate-package";
}

function mcpCommand(project: ProjectWithRelease, mcp: MCPManifest): { command: string; args: string[] } | null {
  const id = packageId(project);
  const runtime = mcpRuntime(mcp);
  if (runtime.includes("npx") || isNpmProject(project, mcp)) return { command: "npx", args: ["-y", id] };
  if (runtime.includes("uvx") || isPythonProject(project, mcp)) return { command: "uvx", args: [id] };
  if (runtime.includes("docker")) return { command: "docker", args: ["run", "--rm", "-i", id] };
  return null;
}

function configSnippet(project: ProjectWithRelease, mcp: MCPManifest | null): string | null {
  if (!mcp) return null;
  const command = mcpCommand(project, mcp);
  if (!command) return null;
  return JSON.stringify(
    {
      mcpServers: {
        [serverKey(project.name)]: command,
      },
    },
    null,
    2,
  );
}

function runtimeRequirements(project: ProjectWithRelease, mcp: MCPManifest | null): string[] {
  const requirements = new Set<string>();
  for (const runtime of mcpRuntime(mcp)) {
    requirements.add(MCP_LABELS[runtime] || runtime);
  }
  if (isNpmProject(project, mcp)) requirements.add("Node.js / npm");
  if (isPythonProject(project, mcp)) requirements.add("Python / uv or pip");
  if (isRustProject(project, mcp)) requirements.add("Rust / Cargo");
  if (isGoProject(project, mcp)) requirements.add("Go toolchain");
  if (project.language) requirements.add(project.language);
  return Array.from(requirements).slice(0, 5);
}

function authNotes(mcp: MCPManifest | null): string[] {
  const auth = mcpAuth(mcp);
  return auth.map((item) => MCP_LABELS[item] || item);
}

function sourceLabel(project: ProjectWithRelease): string {
  if (project.source_type && project.source_package_id) return `${project.source_type}:${project.source_package_id}`;
  if (project.source_type) return project.source_type;
  return "github";
}

export function buildAgentInstallInfo(
  project: ProjectWithRelease,
  mcp: MCPManifest | null,
  verification: VerificationResult | null,
): AgentInstallInfo {
  return {
    installCommand: installCommand(project, mcp),
    configSnippet: configSnippet(project, mcp),
    runtimeRequirements: runtimeRequirements(project, mcp),
    authNotes: authNotes(mcp),
    verifiedDate: verification?.verified_at || null,
    sourceLabel: sourceLabel(project),
  };
}
