import CopySnippetButton from "@/app/components/copy-snippet-button";
import type { AgentInstallInfo } from "@/lib/agent-install";

export interface AgentInstallLabels {
  title: string;
  installCommand: string;
  agentConfig: string;
  runtimeRequirements: string;
  authEnv: string;
  authUnknown: string;
  verifiedDate: string;
  source: string;
  noAgentConfig: string;
  copy: string;
  copied: string;
}

function Snippet({
  value,
  copyLabel,
  copiedLabel,
}: {
  value: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  return (
    <div className="rounded border border-fm-border bg-fm-bg">
      <div className="flex items-center justify-end border-b border-fm-border/40 px-2 py-1">
        <CopySnippetButton text={value} copyLabel={copyLabel} copiedLabel={copiedLabel} />
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap p-2 text-[10px] leading-relaxed text-fm-text font-mono">
        {value}
      </pre>
    </div>
  );
}

export default function AgentInstallCard({
  info,
  labels,
}: {
  info: AgentInstallInfo;
  labels: AgentInstallLabels;
}) {
  return (
    <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3 mb-4">
      <h3 className="text-[11px] font-bold text-fm-green border-b border-fm-border pb-1 mb-2">
        {labels.title}
      </h3>
      <div className="space-y-3 text-[11px]">
        <div>
          <div className="mb-1 text-fm-text-light">{labels.installCommand}</div>
          <Snippet value={info.installCommand} copyLabel={labels.copy} copiedLabel={labels.copied} />
        </div>

        <div>
          <div className="mb-1 text-fm-text-light">{labels.agentConfig}</div>
          {info.configSnippet ? (
            <Snippet value={info.configSnippet} copyLabel={labels.copy} copiedLabel={labels.copied} />
          ) : (
            <p className="text-[10px] text-fm-text-light border border-fm-border rounded bg-fm-bg p-2">
              {labels.noAgentConfig}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 text-[10px]">
          <div>
            <div className="text-fm-text-light">{labels.runtimeRequirements}</div>
            <div className="font-bold">{info.runtimeRequirements.length > 0 ? info.runtimeRequirements.join(", ") : "README"}</div>
          </div>
          <div>
            <div className="text-fm-text-light">{labels.authEnv}</div>
            <div className="font-bold">{info.authNotes.length > 0 ? info.authNotes.join(", ") : labels.authUnknown}</div>
          </div>
          <div>
            <div className="text-fm-text-light">{labels.source}</div>
            <div className="font-mono">{info.sourceLabel}</div>
          </div>
          {info.verifiedDate && (
            <div>
              <div className="text-fm-text-light">{labels.verifiedDate}</div>
              <div className="font-bold">{new Date(info.verifiedDate).toLocaleDateString()}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
