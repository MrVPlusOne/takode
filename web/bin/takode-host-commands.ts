/**
 * `takode host add|list|remove`: register the machines that may run sessions
 * for this coordinator. Registering prints the host's token once, plus the
 * command that starts `takode node` on that machine.
 */

export type HostRow = {
  id: string;
  name: string;
  online?: boolean;
  lastSeenAt?: number | null;
  processes?: number;
  build?: string | null;
  buildMismatch?: boolean;
  autoUpdate?: boolean;
  updating?: boolean;
  updateError?: string | null;
  updateWaitingFor?: string | null;
};

export async function handleHost(base: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const json = rest.includes("--json");
  switch (subcommand) {
    case "add":
      return addHost(base, rest, json);
    case "list":
    case undefined:
      return listHosts(base, json);
    case "remove":
      return removeHost(base, rest);
    default:
      throw new Error(
        "Usage: takode host add <name> [--coordinator-url <url>] [--json] | takode host list | takode host remove <name>",
      );
  }
}

async function addHost(base: string, args: string[], json: boolean): Promise<void> {
  const name = args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--coordinator-url");
  if (!name) throw new Error("Usage: takode host add <name> [--coordinator-url <url>]");
  const urlIndex = args.indexOf("--coordinator-url");
  const coordinatorUrl = urlIndex !== -1 ? args[urlIndex + 1] : undefined;
  const result = (await request(base, "POST", "/hosts", { name })) as {
    host: HostRow;
    token: string;
    hostPort: number;
  };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const url = coordinatorUrl ?? "<coordinator-url>";
  console.log(`Registered host ${result.host.name} (${result.host.id}).`);
  console.log("");
  console.log("Its token is shown only now. On that machine, save it to a file only you can read:");
  console.log(`  umask 077 && printf '%s' '${result.token}' > ~/.takode-host-token`);
  console.log("");
  console.log("Then start the helper from a Takode checkout or install on that machine:");
  console.log(`  bun web/bin/takode-node.ts --coordinator ${url} --token-file ~/.takode-host-token`);
  if (!coordinatorUrl) {
    console.log("");
    console.log(`Replace <coordinator-url> with an address that reaches this server's host port ${result.hostPort},`);
    console.log(
      `for example http://127.0.0.1:13456 through a tunnel such as ssh -R 13456:127.0.0.1:${result.hostPort} <host>.`,
    );
  }
}

async function listHosts(base: string, json: boolean): Promise<void> {
  const { hosts, build } = (await request(base, "GET", "/hosts")) as { hosts: HostRow[]; build?: string | null };
  if (json) {
    console.log(JSON.stringify(hosts, null, 2));
    return;
  }
  if (hosts.length === 0) {
    console.log("No hosts registered. Add one with: takode host add <name>");
    return;
  }
  for (const host of hosts) {
    const state = host.online ? "online" : "offline";
    const seen = host.lastSeenAt ? `, last seen ${new Date(host.lastSeenAt).toISOString()}` : "";
    console.log(`${host.name}  ${state}  ${host.processes ?? 0} process(es)${seen}  [${host.id}]`);
    const version = hostVersionLine(host, build ?? null);
    if (version) console.log(`  ${version}`);
  }
}

/** The host's Takode build compared with this server's, and its auto-update state. */
export function hostVersionLine(host: HostRow, serverBuild: string | null): string {
  const parts: string[] = [];
  if (host.build) parts.push(`takode ${host.build.slice(0, 8)}`);
  if (host.buildMismatch) {
    const server = serverBuild ? serverBuild.slice(0, 8) : "unknown";
    parts.push(host.build ? `differs from this server (${server})` : "build unknown: update takode on the host");
  }
  if (host.autoUpdate) {
    parts.push(
      host.updateError
        ? `auto-update failed: ${host.updateError}`
        : host.updating
          ? "updating"
          : host.buildMismatch
            ? host.updateWaitingFor
              ? `auto-update waits until ${host.updateWaitingFor}`
              : "auto-update pending"
            : "auto-update on",
    );
  }
  return parts.join(", ");
}

async function removeHost(base: string, args: string[]): Promise<void> {
  const target = args.find((arg) => !arg.startsWith("--"));
  if (!target) throw new Error("Usage: takode host remove <name>");
  const { hosts } = (await request(base, "GET", "/hosts")) as { hosts: HostRow[] };
  const host = hosts.find((candidate) => candidate.name === target || candidate.id === target);
  if (!host) throw new Error(`No host named ${target}`);
  await request(base, "DELETE", `/hosts/${encodeURIComponent(host.id)}`);
  console.log(`Removed host ${host.name}; its token no longer connects.`);
}

async function request(base: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const value = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
  return value;
}
