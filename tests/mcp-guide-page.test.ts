import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("referral growth learn guides", () => {
  it("ships the MCP guide route with metadata, structured data, and Freshcrate project links", () => {
    const guidePath = path.join(process.cwd(), "app", "learn", "best-mcp-servers-for-claude-code", "page.tsx");
    expect(fs.existsSync(guidePath)).toBe(true);
    const guide = fs.readFileSync(guidePath, "utf8");

    expect(guide).toContain("export const metadata");
    expect(guide).toContain('canonical: "/learn/best-mcp-servers-for-claude-code"');
    expect(guide).toContain('application/ld+json');
    expect(guide).toContain('"@type": "Article"');
    expect(guide).toContain('Best MCP Servers for Claude Code');
    expect(guide).toContain('/tag/mcp');
    expect(guide).toContain('/tag/claude-code');
    expect(guide).toContain('/browse?category=MCP%20Servers');
    expect(guide).toContain('everything-claude-code');
    expect(guide).toContain('chrome-devtools-mcp');
    expect(guide).toContain('playwright-mcp');
    expect(guide).toContain('fastmcp');
    expect(guide).toContain('mcp-toolbox');
    expect(guide).toContain('MCP servers that actually improve developer productivity');
    expect(guide).toContain('Context7');
    expect(guide).toContain('Postgres');
    expect(guide).toContain('Redis');
    expect(guide).toContain('Docker');
    expect(guide).toContain('Kubernetes');
    expect(guide).toContain('Grafana');
    expect(guide).toContain('Sentry');
    expect(guide).toContain('Semgrep');
    expect(guide).toContain('Trivy');
    expect(guide).toContain('Firecrawl');
    expect(guide).toContain('ArXiv');
    expect(guide).toContain('docs/context');
    expect(guide).toContain('observability/security');
  });

  it("ships the agent frameworks guide route with metadata, structured data, and key framework links", () => {
    const guidePath = path.join(process.cwd(), "app", "learn", "best-open-source-ai-agent-frameworks", "page.tsx");
    expect(fs.existsSync(guidePath)).toBe(true);
    const guide = fs.readFileSync(guidePath, "utf8");

    expect(guide).toContain("export const metadata");
    expect(guide).toContain('canonical: "/learn/best-open-source-ai-agent-frameworks"');
    expect(guide).toContain('application/ld+json');
    expect(guide).toContain('"@type": "Article"');
    expect(guide).toContain('Best Open Source AI Agent Frameworks');
    expect(guide).toContain('/tag/agent');
    expect(guide).toContain('/tag/llm');
    expect(guide).toContain('/compare');
    expect(guide).toContain('langgraph');
    expect(guide).toContain('crewAI');
    expect(guide).toContain('agentscope');
    expect(guide).toContain('langchain');
    expect(guide).toContain('AutoGPT');
  });

  it("ships the LangGraph vs CrewAI vs AutoGen compare page with metadata, structured data, and Freshcrate links", () => {
    const comparePath = path.join(process.cwd(), "app", "compare", "langgraph-vs-crewai-vs-autogen", "page.tsx");
    expect(fs.existsSync(comparePath)).toBe(true);
    const compareGuide = fs.readFileSync(comparePath, "utf8");

    expect(compareGuide).toContain("export const metadata");
    expect(compareGuide).toContain('canonical: "/compare/langgraph-vs-crewai-vs-autogen"');
    expect(compareGuide).toContain('application/ld+json');
    expect(compareGuide).toContain('"@type": "Article"');
    expect(compareGuide).toContain('LangGraph vs CrewAI vs AutoGen');
    expect(compareGuide).toContain('One-paragraph verdict');
    expect(compareGuide).toContain('Feature comparison table');
    expect(compareGuide).toContain('Operational complexity');
    expect(compareGuide).toContain('Observability and ecosystem notes');
    expect(compareGuide).toContain('/learn/best-open-source-ai-agent-frameworks');
    expect(compareGuide).toContain('/tag/multi-agent');
    expect(compareGuide).toContain('/tag/agentic-ai');
    expect(compareGuide).toContain('langgraph');
    expect(compareGuide).toContain('crewAI');
    expect(compareGuide).toContain('autogen');
  });

  it("links the comparison page from compare flows, the framework guide, and sitemap", () => {
    const compareIndex = fs.readFileSync(path.join(process.cwd(), "app", "compare", "page.tsx"), "utf8");
    const frameworksGuide = fs.readFileSync(path.join(process.cwd(), "app", "learn", "best-open-source-ai-agent-frameworks", "page.tsx"), "utf8");
    const sitemap = fs.readFileSync(path.join(process.cwd(), "app", "sitemap.ts"), "utf8");

    expect(compareIndex).toContain('/compare/langgraph-vs-crewai-vs-autogen');
    expect(compareIndex).toContain('Featured comparisons');
    expect(frameworksGuide).toContain('/compare/langgraph-vs-crewai-vs-autogen');
    expect(sitemap).toContain('/compare/langgraph-vs-crewai-vs-autogen');
  });

  it("links both guides from the learn index and sitemap so crawlers can discover them", () => {
    const learnIndex = fs.readFileSync(path.join(process.cwd(), "app", "learn", "page.tsx"), "utf8");
    const sitemap = fs.readFileSync(path.join(process.cwd(), "app", "sitemap.ts"), "utf8");

    expect(learnIndex).toContain('/learn/best-mcp-servers-for-claude-code');
    expect(learnIndex).toContain('/learn/best-open-source-ai-agent-frameworks');
    expect(learnIndex).toContain('Operator guides');
    expect(sitemap).toContain('/learn/best-mcp-servers-for-claude-code');
    expect(sitemap).toContain('/learn/best-open-source-ai-agent-frameworks');
  });

  it("promotes referral-growth guides on the homepage and compare hub", () => {
    const homePage = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf8");
    const compareIndex = fs.readFileSync(path.join(process.cwd(), "app", "compare", "page.tsx"), "utf8");

    expect(homePage).toContain('Best of freshcrate');
    expect(homePage).toContain('/learn/best-mcp-servers-for-claude-code');
    expect(homePage).toContain('/learn/best-open-source-ai-agent-frameworks');
    expect(homePage).toContain('/compare/langgraph-vs-crewai-vs-autogen');
    expect(compareIndex).toContain('/learn/best-open-source-ai-agent-frameworks');
  });

  it("adds contextual guide links to high-value tag pages", () => {
    const tagPage = fs.readFileSync(path.join(process.cwd(), "app", "tag", "[tag]", "page.tsx"), "utf8");

    expect(tagPage).toContain('guideLinksByTag');
    expect(tagPage).toContain('/learn/best-mcp-servers-for-claude-code');
    expect(tagPage).toContain('/learn/best-open-source-ai-agent-frameworks');
    expect(tagPage).toContain('Guides for this tag');
    expect(tagPage).toContain('tag:${normalizedTag}->guide:');
  });

  it("ships the coding agents guide route with metadata, structured data, and key package links", () => {
    const guidePath = path.join(process.cwd(), "app", "learn", "best-coding-agents", "page.tsx");
    expect(fs.existsSync(guidePath)).toBe(true);
    const guide = fs.readFileSync(guidePath, "utf8");

    expect(guide).toContain("export const metadata");
    expect(guide).toContain('canonical: "/learn/best-coding-agents"');
    expect(guide).toContain('application/ld+json');
    expect(guide).toContain('"@type": "Article"');
    expect(guide).toContain('Best Coding Agents');
    expect(guide).toContain('/tag/claude-code');
    expect(guide).toContain('/tag/code-generation');
    expect(guide).toContain('/tag/developer-tools');
    expect(guide).toContain('hermes-agent');
    expect(guide).toContain('continue');
    expect(guide).toContain('tabby');
    expect(guide).toContain('sweep');
    expect(guide).toContain('Claude Code alternatives');
    expect(guide).toContain('Best supporting tools');
  });

  it("links the coding agents guide from the learn index and tag guide map", () => {
    const learnIndex = fs.readFileSync(path.join(process.cwd(), "app", "learn", "page.tsx"), "utf8");
    const tagPage = fs.readFileSync(path.join(process.cwd(), "app", "tag", "[tag]", "page.tsx"), "utf8");

    expect(learnIndex).toContain('/learn/best-coding-agents');
    expect(tagPage).toContain('/learn/best-coding-agents');
    expect(tagPage).toContain('code-generation');
    expect(tagPage).toContain('developer-tools');
  });

  it("ships the browser automation guide route with metadata, structured data, and key package links", () => {
    const guidePath = path.join(process.cwd(), "app", "learn", "best-browser-automation-tools-for-ai-agents", "page.tsx");
    expect(fs.existsSync(guidePath)).toBe(true);
    const guide = fs.readFileSync(guidePath, "utf8");

    expect(guide).toContain("export const metadata");
    expect(guide).toContain('canonical: "/learn/best-browser-automation-tools-for-ai-agents"');
    expect(guide).toContain('application/ld+json');
    expect(guide).toContain('"@type": "Article"');
    expect(guide).toContain('Best Browser Automation Tools for AI Agents');
    expect(guide).toContain('/tag/browser-automation');
    expect(guide).toContain('/tag/automation');
    expect(guide).toContain('playwright-mcp');
    expect(guide).toContain('chrome-devtools-mcp');
    expect(guide).toContain('browser-use');
    expect(guide).toContain('stagehand');
    expect(guide).toContain('web automation agents');
    expect(guide).toContain('Best supporting surfaces');
  });

  it("links the browser automation guide from the learn index, tag guide map, and sitemap", () => {
    const learnIndex = fs.readFileSync(path.join(process.cwd(), "app", "learn", "page.tsx"), "utf8");
    const tagPage = fs.readFileSync(path.join(process.cwd(), "app", "tag", "[tag]", "page.tsx"), "utf8");
    const sitemap = fs.readFileSync(path.join(process.cwd(), "app", "sitemap.ts"), "utf8");

    expect(learnIndex).toContain('/learn/best-browser-automation-tools-for-ai-agents');
    expect(tagPage).toContain('/learn/best-browser-automation-tools-for-ai-agents');
    expect(tagPage).toContain('browser-automation');
    expect(tagPage).toContain('automation');
    expect(sitemap).toContain('/learn/best-browser-automation-tools-for-ai-agents');
  });

  it("ships the RAG and memory guide route with metadata, structured data, and key package links", () => {
    const guidePath = path.join(process.cwd(), "app", "learn", "best-rag-memory-tools-for-agents", "page.tsx");
    expect(fs.existsSync(guidePath)).toBe(true);
    const guide = fs.readFileSync(guidePath, "utf8");

    expect(guide).toContain("export const metadata");
    expect(guide).toContain('canonical: "/learn/best-rag-memory-tools-for-agents"');
    expect(guide).toContain('application/ld+json');
    expect(guide).toContain('"@type": "Article"');
    expect(guide).toContain('Best RAG and Memory Tools for Agents');
    expect(guide).toContain('/tag/rag');
    expect(guide).toContain('/tag/vector-database');
    expect(guide).toContain('/browse?category=RAG%20%26%20Memory');
    expect(guide).toContain('ragflow');
    expect(guide).toContain('vllm');
    expect(guide).toContain('mem0');
    expect(guide).toContain('graphrag');
    expect(guide).toContain('agent memory tools');
    expect(guide).toContain('Best supporting surfaces');
  });

  it("links the RAG and memory guide from the learn index, tag guide map, and sitemap", () => {
    const learnIndex = fs.readFileSync(path.join(process.cwd(), "app", "learn", "page.tsx"), "utf8");
    const tagPage = fs.readFileSync(path.join(process.cwd(), "app", "tag", "[tag]", "page.tsx"), "utf8");
    const sitemap = fs.readFileSync(path.join(process.cwd(), "app", "sitemap.ts"), "utf8");

    expect(learnIndex).toContain('/learn/best-rag-memory-tools-for-agents');
    expect(tagPage).toContain('/learn/best-rag-memory-tools-for-agents');
    expect(tagPage).toContain('rag');
    expect(tagPage).toContain('vector-database');
    expect(sitemap).toContain('/learn/best-rag-memory-tools-for-agents');
  });

  it("ships the observability guide route with metadata, structured data, and key package links", () => {
    const guidePath = path.join(process.cwd(), "app", "learn", "best-ai-agent-observability-tools", "page.tsx");
    expect(fs.existsSync(guidePath)).toBe(true);
    const guide = fs.readFileSync(guidePath, "utf8");

    expect(guide).toContain("export const metadata");
    expect(guide).toContain('canonical: "/learn/best-ai-agent-observability-tools"');
    expect(guide).toContain('application/ld+json');
    expect(guide).toContain('"@type": "Article"');
    expect(guide).toContain('Best AI Agent Observability Tools');
    expect(guide).toContain('/tag/observability');
    expect(guide).toContain('/tag/evaluation');
    expect(guide).toContain('/tag/tracing');
    expect(guide).toContain('langfuse');
    expect(guide).toContain('mlflow');
    expect(guide).toContain('agentops');
    expect(guide).toContain('braintrust');
    expect(guide).toContain('agent observability');
    expect(guide).toContain('Best supporting surfaces');
  });

  it("links the observability guide from the learn index, tag guide map, and sitemap", () => {
    const learnIndex = fs.readFileSync(path.join(process.cwd(), "app", "learn", "page.tsx"), "utf8");
    const tagPage = fs.readFileSync(path.join(process.cwd(), "app", "tag", "[tag]", "page.tsx"), "utf8");
    const sitemap = fs.readFileSync(path.join(process.cwd(), "app", "sitemap.ts"), "utf8");

    expect(learnIndex).toContain('/learn/best-ai-agent-observability-tools');
    expect(tagPage).toContain('/learn/best-ai-agent-observability-tools');
    expect(tagPage).toContain('observability');
    expect(tagPage).toContain('evaluation');
    expect(tagPage).toContain('tracing');
    expect(sitemap).toContain('/learn/best-ai-agent-observability-tools');
  });

  it("adds project-page guide modules for featured packages", () => {
    const projectPage = fs.readFileSync(path.join(process.cwd(), "app", "projects", "[name]", "page.tsx"), "utf8");

    expect(projectPage).toContain('appearsInGuidesByProject');
    expect(projectPage).toContain('Appears in guides');
    expect(projectPage).toContain('/learn/best-mcp-servers-for-claude-code');
    expect(projectPage).toContain('/learn/best-coding-agents');
    expect(projectPage).toContain('/learn/best-browser-automation-tools-for-ai-agents');
    expect(projectPage).toContain('/learn/best-rag-memory-tools-for-agents');
    expect(projectPage).toContain('/learn/best-ai-agent-observability-tools');
    expect(projectPage).toContain('guide:${project.name}->');
  });

  it("ships the AI agent stack map guide with metadata, structured data, and cluster links", () => {
    const guidePath = path.join(process.cwd(), "app", "learn", "ai-agent-stack-map", "page.tsx");
    expect(fs.existsSync(guidePath)).toBe(true);
    const guide = fs.readFileSync(guidePath, "utf8");

    expect(guide).toContain("export const metadata");
    expect(guide).toContain('canonical: "/learn/ai-agent-stack-map"');
    expect(guide).toContain('application/ld+json');
    expect(guide).toContain('"@type": "Article"');
    expect(guide).toContain('AI Agent Stack Map');
    expect(guide).toContain('/learn/best-mcp-servers-for-claude-code');
    expect(guide).toContain('/learn/best-open-source-ai-agent-frameworks');
    expect(guide).toContain('/learn/best-coding-agents');
    expect(guide).toContain('/learn/best-browser-automation-tools-for-ai-agents');
    expect(guide).toContain('/learn/best-rag-memory-tools-for-agents');
    expect(guide).toContain('/learn/best-ai-agent-observability-tools');
    expect(guide).toContain('/compare/langgraph-vs-crewai-vs-autogen');
    expect(guide).toContain('components of an AI agent system');
  });

  it("links the AI agent stack map from the learn index, homepage, and sitemap", () => {
    const learnIndex = fs.readFileSync(path.join(process.cwd(), "app", "learn", "page.tsx"), "utf8");
    const homePage = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf8");
    const sitemap = fs.readFileSync(path.join(process.cwd(), "app", "sitemap.ts"), "utf8");

    expect(learnIndex).toContain('/learn/ai-agent-stack-map');
    expect(homePage).toContain('/learn/ai-agent-stack-map');
    expect(sitemap).toContain('/learn/ai-agent-stack-map');
  });
});
