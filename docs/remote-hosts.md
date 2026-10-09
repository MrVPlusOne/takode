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

The host keeps no Takode configuration or data of its own. Settings come from
the coordinator, which stores the ones that differ per machine (such as which
Claude Code and Codex to run) for each host, and the `quest`, `memory` and
`stream` commands of its sessions read and write through the coordinator.
Session processes on the host get `TAKODE_REMOTE_HOST=1`, so these commands
never answer from files the machine may still have under `~/.companion` (for
example from a time it ran its own server); while the coordinator is
unreachable they say so instead. Only facts of the machine stay on it: its
name, its host token, the options `takode node` was started with, and working
checkouts.

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
   - a forward tunnel opened from the host, when only the host can connect to
     the coordinator's machine (for example a coordinator in a cloud workspace
     and a laptop as the host): `ssh -L 13456:127.0.0.1:3456 <coordinator>`, or
     the workspace's own port forwarding. The host again uses
     `http://127.0.0.1:13456`, which also serves the laptop's browser.

   The coordinator listens on every network interface by default. When it
   should be reachable only through tunnels, start it with
   `COMPANION_HOST=127.0.0.1`.

3. **Start `takode node` on the host** from its Takode checkout:

   ```bash
   bun web/bin/takode-node.ts --coordinator http://127.0.0.1:13456 --token-file ~/.takode-host-token
   ```

   It installs the `takode`, `quest`, `memory` and `stream` CLI wrappers, skills and
   Quest Journey phase briefs from that checkout, then connects. `takode host
   list` on the coordinator shows the host as online.

4. **Start sessions on it.** Pick the host in the **Machine** field of the new
   session dialog, or from a leader run
   `takode spawn --host <name> --cwd <checkout path on the host>`. A leader
   that itself runs on a host spawns its workers there without `--host`. With a host
   selected, the dialog's folder browser and branch picker read the host's
   folders and repos, and recent folders are kept per machine. Worktrees are
   created on the host. Folder browsing needs the host's `takode node` to run a
   build that includes it. A running session's Git status, diffs, the diff
   panel's base-branch and commit choices, and pulls all read its checkout on
   the host. Quest delivery checks (`takode board approve-delivery-target`,
   `record-work-delivery`, `work-to-memory` and port tracking) run on the
   machine holding the worker's port target, and recorded delivery commits are
   read there later; these need the host's `takode node` on a build that
   includes them.

## Machine names

Every machine has a name that belongs to the machine, kept in its own
`~/.companion/machine.json`, so it stays the same if another machine later
becomes the coordinator. The coordinator names its own machine after its
hostname the first time it starts. A host takes the name it was registered
with, unless it already has a name of its own from another Takode setup, which
it keeps. Rename any machine with **Rename** in **Settings → Hosts**; a host
must be connected to receive its new name.

Each session's instructions and memory catalog say which machine it runs on and
which machine runs the coordinator. Quest notes and debriefs are stamped with
the machine of the session that wrote them, shown next to the author in
Questmaster and in `quest show` and `quest feedback`, because paths and
commands in a note refer to that machine. Notes written before stamps existed
were stamped once by the coordinator on its first start with this feature,
after it saved the whole quest store under
`~/.companion/questmaster-backups/migrations/`; `questmaster-live/machine-stamps.json`
records that run and the backup that undoes it.

Memory notes record the same thing in a `machines:` frontmatter list: the
machines that wrote the note, in the order they first did. The server adds the
writing session's machine on `memory write` and on every `memory commit` except
repairs. The memory catalog names the machine most notes come from once and
tags the others after their path, like `note.md [devbox]`; the Memory page shows
the list on each note. Notes written before this existed were stamped once with
the coordinator's machine on its first start with this feature, as one memory
commit per repo (`git revert` undoes it); `.git/takode-machine-stamps.json` in
the memory repo records that run. A repo that was locked or had uncommitted
changes is tried again at the next start.

## Choosing the agent CLIs on a host

Every machine has its own **Claude Code** and **Codex** settings in
**Settings → Hosts**: the coordinator's own machine, plus one entry per
registered host. Each is a path or command on that machine; an
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
- **Stopping the coordinator** (Ctrl-C, `SIGTERM`; anything but a restart):
  stops the sessions on every connected host, since nobody would see their
  output until the next start. They relaunch and resume their conversation the
  next time they are used; `takode node` itself keeps running. A host that is
  offline at that moment cannot be told, so its sessions keep running and the
  next start takes them over, as after a restart.
- **Restarting `takode node`:** ends the sessions it was running. They relaunch
  and resume their conversation the next time they are used.

## Keeping this machine's sessions across restarts

The coordinator's own sessions survive its restarts the same way: the server
starts a `takode node` on its own machine and runs the processes of sessions
without a host under it. After a restart, the new server takes them over when
that node reconnects: a turn in progress keeps running, its output arrives, and
a pending permission prompt is asked again. **Settings → Hosts** shows the
node's status on the coordinator's own machine, the first entry. Sessions that start
while the node is still connecting, such as just after the server starts, wait
for it; if it does not connect within 30 seconds, they start without it.

The server supervises this node itself: it starts it with the server (also
after a reboot), lets a running one reconnect after a restart, and replaces one
that has exited or stays disconnected for 30 seconds. The node runs from the
server's own checkout, so an update restarts it on that checkout's code, only
while none of its sessions is in a turn. Its log is
`~/.companion/logs/local-node-<serverId>.log`.

Only a restart (the Restart Server button) leaves the node and its sessions
running for the next server to take over. Stopping the server stops its
sessions and then the node; they relaunch when next used. Ending the node's
process (the `takode-node.ts` process with `--shared-checkout`) ends its
sessions too; they relaunch when next used, and the server starts a new node.

## Updating Takode

The host's checkout should run the same commit as the coordinator. `takode
host list` and **Settings → Hosts** show each host's commit and flag a
host on another build.

Start `takode node` with `--auto-update` to let the coordinator keep it in
step: whenever the host runs another commit, none of its sessions is in a
turn and none started in the last minute, the coordinator stops the host's
sessions and the node checks out the coordinator's commit (fetching it from
the checkout's remote if needed), runs a frozen install and restarts. Its
sessions relaunch on their next message. It refuses to update a checkout with uncommitted changes, so give the
node a checkout of its own rather than one you work in.

Without `--auto-update`, update the host's checkout and restart `takode node`
yourself whenever the coordinator is updated.

## Moving the coordinator to another machine

The coordinator role can move to a machine that already runs its sessions as
a host, for example from a laptop to an always-on workstation. Sessions stay
on the machines where they run: the old coordinator's own sessions become
sessions on a host named after that machine, and the receiving host's sessions
become the new coordinator's own. `scripts/coordinator-handoff.ts` does the
move:

- **What moves:** settings (the server keeps its identity), quests with their
  images and evidence, memory repos (whole, with their Git history and
  remotes), unarchived sessions with their timers, notifications, boards and
  attachments, registered hosts, landing gates and the landing queue, to-dos
  and the other server state. Export waits for a running landing to finish.
- **What stays:** archived sessions (their history remains in the old
  machine's files), logs, resource leases, worktree checkouts and agent
  artifacts.

1. **Rehearse first** (optional, recommended). On the old coordinator, without
   stopping it:

   ```bash
   bun scripts/coordinator-handoff.ts export --rehearsal --to <new machine> --address <new URL> --package-dir <empty dir>
   ```

   Copy the package folder to the new machine and import it under a separate
   `HOME` and port, then start a server there with that `HOME` and port. A
   rehearsal copy starts no agents (both machines' Claude and Codex settings
   point to a program that does not exist) and sends no phone alerts, so
   copied timers cannot resume real sessions next to the live ones. Connect a
   node to it under another host name to try the path from the old machine.
   Copying the rehearsal package ahead of time also lets the real move send
   only what changed since (for example with `rsync`).

2. **Stop the old coordinator** with a normal stop (not Restart Server). This
   also stops its own `takode node`, so every session process ends; sessions
   resume their conversations the next time they are used.

3. **Export** on the old machine:

   ```bash
   bun scripts/coordinator-handoff.ts export --to <new machine> --address <new URL> --package-dir <empty dir>
   ```

   It refuses while the server or its node still runs. It writes the package
   with a SHA-256 for every file, a token file for the old machine's
   `takode node`, and a **fence**: from now on a server with this identity
   refuses to start on the old machine and prints where it moved, so two
   coordinators can never change the same quests, memory and sessions.

4. **Copy the package** to the new machine and stop its `takode node` (its
   sessions are now the coordinator's own and start under the coordinator).

5. **Import** on the new machine:

   ```bash
   bun scripts/coordinator-handoff.ts import --package-dir <dir> --check
   bun scripts/coordinator-handoff.ts import --package-dir <dir> --replace-existing
   ```

   It checks every file against its checksum before writing anything and
   moves paths it replaces into `~/.companion/coordinator-handoff-backups/`.
   It only imports on the machine the package names.

6. **Start the server** on the new machine, then check **Settings → Hosts**:
   the new coordinator's own machine has the Claude Code and Codex settings
   the host had (a `--claude` or `--codex` flag on its old node is not
   carried over).

7. **Start `takode node` on the old machine** with the token file the export
   printed, pointed at the new coordinator. Give it a checkout of its own if
   it uses `--auto-update`.

**Rolling back:** stop the new coordinator, then on the old machine run
`bun scripts/coordinator-handoff.ts reclaim --after-epoch <n>`, where `<n>` is
the `epoch` in `~/.companion/coordinator/<serverId>.json` on the new machine,
and start the old server again. Its data is as it was at the export; changes
made on the new machine after the move are not carried back.

## Latency

Every command an agent on the host runs (`takode`, `quest`, `memory`, `stream`) is a
round trip to the coordinator, through the tunnel if you use one.
`takode latency` on the host shows that time as transport. A remote terminal
echoes each keystroke after one round trip.
