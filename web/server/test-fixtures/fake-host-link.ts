import type { AgentSocket } from "../remote-host/host-agent.js";
import type { HostLinkManager, HostLinkSocket } from "../remote-host/host-link-manager.js";

/**
 * An in-memory link between one HostAgent and a HostLinkManager, standing in
 * for the WebSocket. `drop()` cuts it the way a lost network would: both sides
 * see a close and messages in flight are lost.
 */
export class FakeHostLink {
  readonly agentSide: AgentSocket;
  readonly coordinatorSide: HostLinkSocket;
  private up = true;

  constructor(
    private readonly manager: HostLinkManager,
    private readonly hostId: string,
  ) {
    const link = this;
    this.agentSide = {
      readyState: 0,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send(data: string) {
        if (link.up) queueMicrotask(() => link.up && manager.handleMessage(hostId, link.coordinatorSide, data));
      },
      close() {
        link.drop();
      },
    };
    this.coordinatorSide = {
      send(data: string) {
        if (link.up) queueMicrotask(() => link.up && link.agentSide.onmessage?.({ data }));
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
