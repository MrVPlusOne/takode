export class CodexMcpToolAvailability {
  private toolsByServer = new Map<string, Set<string>>();

  record(servers: Array<{ name: string; tools?: Array<{ name: string }> }>): void {
    this.toolsByServer = new Map(
      servers.map((server) => [server.name, new Set((server.tools ?? []).map((tool) => tool.name))]),
    );
  }

  has(serverName: string, toolName: string): boolean {
    return this.toolsByServer.get(serverName)?.has(toolName) === true;
  }

  async waitFor(
    serverName: string,
    toolName: string,
    timeoutMs: number,
    shouldContinue: () => boolean,
    refreshIfNeeded: () => Promise<void>,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.has(serverName, toolName)) return true;
      if (!shouldContinue()) return false;
      await refreshIfNeeded();
      if (this.has(serverName, toolName)) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return this.has(serverName, toolName);
  }
}
