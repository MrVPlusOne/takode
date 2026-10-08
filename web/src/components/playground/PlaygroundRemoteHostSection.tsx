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
    settings: { claudeBinary: "", codexBinary: "" },
    commandOverrides: {},
    ...overrides,
  };
}

const ONLINE = mockHost({});
const OFFLINE = mockHost({ online: false });
const OTHER_BUILD = mockHost({ build: "a".repeat(40), buildMismatch: true });
const LONG_NAME = mockHost({ name: "gpu-workstation-west-2" });

/**
 * Mock of the top bar's session title in a 390px bar. Like the real top bar,
 * the chip shrinks to a host icon on phone-width screens.
 */
function TitleBar({ host }: { host: RemoteHost }) {
  return (
    <div className="w-[390px] shrink-0 rounded-lg border border-cc-border bg-cc-card px-2 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <span className="h-7 w-7 shrink-0 rounded-lg bg-cc-hover/60" aria-hidden="true" />
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-cc-success" aria-hidden="true" />
          <span className="shrink-0 text-[11px] font-medium text-cc-muted">#2849</span>
          <span className="min-w-0 truncate text-[11px] font-medium text-cc-fg">
            Show each session's host everywhere it appears
          </span>
          <HostChip host={host} serverBuild={SERVER_BUILD} iconOnPhone />
        </div>
        <span className="ml-auto flex shrink-0 gap-2" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((index) => (
            <span key={index} className="h-7 w-7 rounded-lg bg-cc-hover/60" />
          ))}
        </span>
      </div>
    </div>
  );
}

export function PlaygroundRemoteHostSection() {
  return (
    <PlaygroundSectionGroup groupId="overview">
      <Section
        title="Remote Host Indicators"
        description="Where a session runs. Remote sessions get a host chip in the sidebar, top bar (an icon on phones), hover cards, quest participant chips, worker preview and board; local sessions stay unlabeled except in the session info panel while some session runs remotely."
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
          <Card label="Top bar title (host icon only on phones)">
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
