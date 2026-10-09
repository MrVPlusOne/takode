import type { RemoteHost } from "../../remote-hosts.js";
import { HostChip, SessionMachineSummary } from "../HostBadge.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

const SERVER_BUILD = "b".repeat(40);

function mockHost(overrides: Partial<RemoteHost>): RemoteHost {
  return {
    id: "playground-host",
    name: "devbox",
    createdAt: 0,
    online: true,
    lastSeenAt: null,
    processes: 2,
    build: SERVER_BUILD,
    buildMismatch: false,
    autoUpdate: true,
    updating: false,
    updateError: null,
    updateWaitingFor: null,
    settings: { claudeBinary: "", codexBinary: "" },
    commandOverrides: {},
    ...overrides,
  };
}

const ONLINE = mockHost({});
const OFFLINE = mockHost({ online: false });
const OTHER_BUILD = mockHost({
  build: "a".repeat(40),
  buildMismatch: true,
  updateWaitingFor: "the landing run there finishes",
});
const LONG_NAME = mockHost({ name: "gpu-workstation-west-2" });

/**
 * Mock of the phone top bar's session title in a 390px bar: the host chip sits
 * on the second line next to the session number, below the title.
 */
function TitleBar({ host }: { host: RemoteHost }) {
  return (
    <div className="flex w-[390px] shrink-0 items-center gap-2 rounded-lg border border-cc-border bg-cc-card px-2 py-1.5">
      <span className="h-9 w-9 shrink-0 rounded-lg bg-cc-hover/60" aria-hidden="true" />
      <span className="relative shrink-0" aria-hidden="true">
        <span className="block h-8 w-8 rounded-full bg-cc-hover" />
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-cc-success ring-2 ring-cc-card" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-semibold leading-tight text-cc-fg">
          Show each session's host everywhere it appears
        </span>
        <span className="flex min-w-0 items-center gap-1 text-[11px] leading-tight text-cc-muted">
          <span className="shrink-0">#2849</span>
          <HostChip host={host} serverBuild={SERVER_BUILD} />
        </span>
      </span>
      <span className="flex shrink-0 gap-1.5" aria-hidden="true">
        {[0, 1].map((index) => (
          <span key={index} className="h-9 w-9 rounded-lg bg-cc-hover/60" />
        ))}
      </span>
    </div>
  );
}

export function PlaygroundRemoteHostSection() {
  return (
    <PlaygroundSectionGroup groupId="overview">
      <Section
        title="Remote Host Indicators"
        description="Where a session runs. Remote sessions get a host chip in the sidebar, top bar (below the title on phones), hover cards, quest participant chips, worker preview and board; local sessions stay unlabeled except in the session info panel while some session runs remotely."
      >
        <div className="grid gap-4" data-testid="playground-remote-host-indicators">
          <Card label="Host chip states">
            <div className="flex flex-wrap items-center gap-2">
              <HostChip host={ONLINE} serverBuild={SERVER_BUILD} />
              <HostChip host={OFFLINE} serverBuild={SERVER_BUILD} />
              <HostChip host={OTHER_BUILD} serverBuild={SERVER_BUILD} />
              <HostChip host={undefined} serverBuild={SERVER_BUILD} />
              <HostChip host={LONG_NAME} serverBuild={SERVER_BUILD} />
            </div>
          </Card>
          <Card label="Phone top bar title (host chip below the title)">
            {/* Fixed 390px bars scroll sideways here, so they keep a real phone's width. */}
            <div className="flex flex-col gap-2 overflow-x-auto">
              <TitleBar host={ONLINE} />
              <TitleBar host={OTHER_BUILD} />
              <TitleBar host={LONG_NAME} />
            </div>
          </Card>
          <Card label="Session info: runs on">
            <div className="max-w-sm space-y-2">
              <SessionMachineSummary host={ONLINE} serverBuild={SERVER_BUILD} />
              <SessionMachineSummary host={OFFLINE} serverBuild={SERVER_BUILD} />
              <SessionMachineSummary host={OTHER_BUILD} serverBuild={SERVER_BUILD} />
              <SessionMachineSummary host={null} serverBuild={SERVER_BUILD} />
              <SessionMachineSummary host={undefined} serverBuild={SERVER_BUILD} />
            </div>
          </Card>
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
