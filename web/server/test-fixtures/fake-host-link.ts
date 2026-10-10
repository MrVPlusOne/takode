import type { CoordinatorToHost, HostToCoordinator } from "../../shared/host-protocol.js";
import type { AgentSocket } from "../remote-host/host-agent.js";
import { HostLinkCodec } from "../remote-host/host-link-codec.js";
import type { HostLinkManager, HostLinkSocket } from "../remote-host/host-link-manager.js";

type Frame = string | Uint8Array;

/**
 * An in-memory link between one HostAgent and a HostLinkManager, standing in
 * for the WebSocket. `drop()` cuts it the way a lost network would: both sides
 * see a close and messages in flight are lost.
 *
 * It also decodes every frame it carries, as the receiving side does, so tests
 * can read the messages each way (`sentToHost`, `sentToCoordinator`) and the
 * frames as sent (`frames`), compressed or not.
 */
export class FakeHostLink {
  readonly agentSide: AgentSocket;
  readonly coordinatorSide: HostLinkSocket;
  readonly sentToHost: CoordinatorToHost[] = [];
  readonly sentToCoordinator: HostToCoordinator[] = [];
  readonly frames: { to: "host" | "coordinator"; frame: Frame }[] = [];
  private up = true;
  private readonly hostReader = new HostLinkCodec();
  private readonly coordinatorReader = new HostLinkCodec();

  constructor(
    private readonly manager: HostLinkManager,
    private readonly hostId: string,
    /** Rewrites a message on its way to the coordinator, e.g. to stand in for an older host. */
    toCoordinator: (message: HostToCoordinator) => HostToCoordinator = (message) => message,
  ) {
    const link = this;
    this.agentSide = {
      readyState: 0,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send(data: Frame) {
        if (!link.up) return;
        link.frames.push({ to: "coordinator", frame: data });
        const message = JSON.parse(link.coordinatorReader.decode(data)) as HostToCoordinator;
        link.sentToCoordinator.push(message);
        const rewritten = toCoordinator(message);
        // A compressed frame cannot be rewritten without breaking the coordinator's compression history.
        if (rewritten !== message && typeof data !== "string") throw new Error("Only plain frames can be rewritten");
        const delivered = rewritten === message ? data : JSON.stringify(rewritten);
        queueMicrotask(() => link.up && manager.handleMessage(hostId, link.coordinatorSide, delivered));
      },
      close() {
        link.drop();
      },
    };
    this.coordinatorSide = {
      send(data: Frame) {
        if (!link.up) return;
        link.frames.push({ to: "host", frame: data });
        link.sentToHost.push(JSON.parse(link.hostReader.decode(data)) as CoordinatorToHost);
        queueMicrotask(() => link.up && link.agentSide.onmessage?.({ data }));
      },
      close() {
        link.drop();
      },
    };
    manager.attach(hostId, this.coordinatorSide);
    queueMicrotask(() => {
      this.agentSide.readyState = 1;
      this.agentSide.onopen?.({});
    });
  }

  drop(): void {
    if (!this.up) return;
    this.up = false;
    this.agentSide.readyState = 3;
    this.manager.detach(this.hostId, this.coordinatorSide);
    this.agentSide.onclose?.({});
  }
}
