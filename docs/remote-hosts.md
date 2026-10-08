# Running sessions on another machine

One Takode server, the **coordinator**, can run sessions on other machines,
called **hosts**. The coordinator keeps all shared state (sessions, quests,
memory, the board) and serves the browser. A host only runs the session
processes: it runs `takode node`, which connects out to the coordinator, so the
host needs no open inbound ports.

Use this when a project, its data or its hardware lives on another machine,
such as a cloud workspace or a GPU box, and you want its sessions in the same
Takode as everything else.

## Requirements on the host

- A Takode checkout with its dependencies installed:
  `bun install --cwd web --frozen-lockfile`. Keep it at the coordinator's
  commit (see [Updating Takode](#updating-takode)); the coordinator refuses a
  host that speaks an older protocol ("Update takode on the host").
- The agent CLIs its sessions use (`claude`, `codex`), each signed in on that
  machine. Credentials are never copied between machines.
- The project checkouts the sessions will work in.

Do not start a Takode server on the host. `takode node` is the only Takode
process it needs.

## Setup

1. **Register the host on the coordinator.** Run `takode host add <name>` or use
   **Settings → Hosts**. The host's token is shown only once. On the
   host, save it to a file only you can read:

   ```bash
   umask 077 && printf '%s' '<token>' > ~/.takode-host-token
   ```

   `takode host remove <name>` revokes the token.

2. **Give the host a way to reach the coordinator.** Any of these works:
   - an `https://` address of the coordinator that the host can reach;
   - a reverse SSH tunnel opened from the coordinator's machine, so the host
     reaches the coordinator on its own loopback and nothing is exposed to the
     network:

     ```bash
     ssh -R 13456:127.0.0.1:3456 <host>   # 3456 is the coordinator's port
     ```

     The host then uses `http://127.0.0.1:13456`. `takode node` accepts plain
     `http://` only for loopback addresses (or with `--allow-insecure` when the
     network already encrypts the traffic).

3. **Start `takode node` on the host** from its Takode checkout:

   ```bash
   bun web/bin/takode-node.ts --coordinator http://127.0.0.1:13456 --token-file ~/.takode-host-token
   ```

   It installs the `takode`, `quest` and `memory` CLI wrappers, skills and
   Quest Journey phase briefs from that checkout, then connects. `takode host
   list` on the coordinator shows the host as online.

4. **Start sessions on it.** Pick the host in the **Machine** field of the new
   session dialog, or from a leader run
   `takode spawn --host <name> --cwd <checkout path on the host>`. Worktrees are
   created on the host.

## Choosing the agent CLIs on a host

Every machine has its own **Claude Code** and **Codex** settings in
**Settings → Hosts**: **This machine** for the coordinator's own machine, plus
one entry per registered host. Each is a path or command on that machine; an
empty field means the `claude` or `codex` on that machine's `PATH`. The
coordinator stores the settings and sends a host its own whenever it connects
or they change, so there is nothing to copy between machines. New sessions use
a changed setting at once; running ones pick it up when they relaunch.

`takode node` can also be started with `--claude` and `--codex`:

```bash
bun web/bin/takode-node.ts ... --claude /path/to/claude --codex /path/to/codex
```

A flag wins over the host's setting for as long as that node runs, and
**Settings → Hosts** shows which program the flag makes it run. Prefer the
setting; keep the flags for a node that must differ from its stored setting.

For example, to run a host's Claude sessions through GitHub Copilot, run
`scripts/setup-claude-copilot.sh` on the host (see
[Using Takode with GitHub Copilot](github-copilot.md)) and set that host's
**Claude Code** to the launcher it prints.

## Keeping it running

Neither the tunnel nor `takode node` restarts by itself after a reboot. Run each
in a restart loop inside `tmux` (or a service manager), for example:

```bash
# On the coordinator's machine
tmux new -d -s takode-tunnel \
  'while true; do ssh -R 13456:127.0.0.1:3456 <host> -- "while true; do sleep 3600; done"; sleep 5; done'

# On the host
tmux new -d -s takode-node \
  'cd ~/takode && while true; do bun web/bin/takode-node.ts --coordinator http://127.0.0.1:13456 --token-file ~/.takode-host-token --auto-update; sleep 10; done'
```

What survives what:

- **Network drops, host sleep and coordinator restarts:** sessions keep running.
  The host buffers their output and replays it when the link returns, and agent
  CLIs on the host wait for the coordinator instead of failing.
- **Restarting `takode node`:** ends the sessions it was running. They relaunch
  and resume their conversation the next time they are used.

## Updating Takode

The host's checkout should run the same commit as the coordinator. `takode
host list` and **Settings → Hosts** show each host's commit and flag a
host on another build.

Start `takode node` with `--auto-update` to let the coordinator keep it in
step: whenever the host runs another commit and none of its sessions is in a
turn, the node checks out the coordinator's commit (fetching it from the
checkout's remote if needed), runs a frozen install and restarts. Its sessions
relaunch on their next message. It refuses to update a checkout with uncommitted changes, so give the
node a checkout of its own rather than one you work in.

Without `--auto-update`, update the host's checkout and restart `takode node`
yourself whenever the coordinator is updated.

## Latency

Every command an agent on the host runs (`takode`, `quest`, `memory`) is a
round trip to the coordinator, through the tunnel if you use one.
`takode latency` on the host shows that time as transport. A remote terminal
echoes each keystroke after one round trip.
