# Monitor-free relay tunnel supervision

Takode's monitor-free relay supervisor is a foreground, user-scoped macOS service. A user LaunchAgent owns one supervisor; the supervisor owns one foreground direct-SSH process group; SSH owns one reverse application forward. No autossh monitor forward is created.

This document separates repository validation and inactive installation from approval-gated live activation. Never treat copying these tracked artifacts as authorization to change a live relay, sshd, tunnel, listener, watcher, or launchd service.

## Tracked artifacts

- `scripts/relay-tunnel-supervisor.sh`: foreground Bash 3.2-compatible supervisor.
- `scripts/relay-tunnel-supervisor.conf.example`: generic runtime configuration shape.
- `scripts/com.takode.relay-tunnel.plist.template`: inactive user LaunchAgent template.
- `web/scripts/relay-tunnel-supervisor.test.ts`: disposable process/ownership/privacy regressions.

Production host aliases, application ports, identity paths, and health endpoints belong only in the installed mode-0600 runtime configuration. Do not commit them or render them into public documentation.

## Stable runtime layout

The approved runtime layout is outside a Git worktree so launchd never depends on a disposable worker checkout:

```text
~/Library/Application Support/Takode/relay-tunnel/
  bin/relay-tunnel-supervisor.sh       # 0700, reviewed installed copy
  config/runtime.conf                  # 0600, runtime-only values
  state/                               # 0700, atomic status/ownership metadata

~/Library/LaunchAgents/
  com.takode.relay-tunnel.plist        # rendered, validated, initially inactive
```

The installed script checksum must match the reviewed tracked artifact used by the approved Execute. The rendered plist substitutes absolute paths for `__SUPERVISOR_PATH__`, `__CONFIG_PATH__`, `__STATE_DIRECTORY__`, and `__HOME_DIRECTORY__`.

## Runtime configuration

The supervisor accepts exactly two arguments:

```text
relay-tunnel-supervisor.sh <absolute-runtime-config> <absolute-state-directory>
```

The runtime config is a strict `KEY=VALUE` file with no shell evaluation:

```text
SSH_HOST=<ssh-config-alias>
SSH_CONFIG_FILE=<absolute-path>
SSH_IDENTITY_FILE=<absolute-path>
REMOTE_BIND_HOST=<loopback-bind-address>
REMOTE_PORT=<application-listener-port>
LOCAL_HOST=<local-destination-address>
LOCAL_PORT=<local-application-port>
HEALTHCHECK_URL=<https-health-endpoint>
```

The runtime config and SSH config must be owned by the current user and mode 0600; the identity must be current-user-owned and mode 0600 or 0400. The state directory must already be current-user-owned mode 0700, or its trusted parent must exist so the supervisor can create the final directory at 0700. The supervisor rejects direct symlinks, symlinked ancestry, unsafe writable ancestry, wrong ownership, and wrong modes without repairing them in place. State-path trust failures leave the untrusted path untouched and report on stderr because writing status there would violate the same boundary. Other fatal trust/config failures record `paused_fatal` and exit zero. Unknown, duplicate, malformed, relative-path, unreadable, or unsafe values likewise pause cleanly instead of entering a launchd restart loop.

The production SSH child always uses absolute `/usr/bin/ssh` with:

- foreground `-N` operation and one explicit reverse forward;
- `BatchMode=yes`, `ConnectTimeout=10`, and `StrictHostKeyChecking=yes`;
- `ServerAliveInterval=10`, `ServerAliveCountMax=3`, and `TCPKeepAlive=no`;
- `ExitOnForwardFailure=yes`, `ControlMaster=no`, and explicit `ClearAllForwardings=no`;
- `IdentitiesOnly=yes`, `IdentityAgent=none`, `AddKeysToAgent=no`, and the explicit config/identity paths;
- a sparse environment containing only HOME, fixed system PATH, USER, and LOGNAME.

Before each child start, the supervisor renders this exact argument array through offline `/usr/bin/ssh -G`. It requires exactly the configured remote forward, no local or dynamic forwards, and `clearallforwardings no`; a forward inherited from the explicit SSH config pauses the wrapper before SSH starts. This preserves the command-line `-R` while preventing the explicit config from silently adding forwarding. Validate the selected identity and known-host state in the same sparse environment before activation. The supervisor never prompts.

## Ownership and lifecycle contract

### Singleton and child ownership

The launchd label `com.takode.relay-tunnel` is the OS-level owner. The supervisor adds an atomic state-directory ownership protocol:

- a wrapper first creates a private, fully populated versioned initializing claim containing PID, process-start identity, token, and inode, then publishes that immutable inode atomically as `owner.lock` with a hard link;
- contenders accept only complete metadata, wait at most two seconds for malformed legacy/incomplete state, then leave an unverifiable claim in place and exit; an exact live initializing or ready owner is rejected without signalling it or changing its status;
- a ready record is published only after the wrapper re-verifies the initializing lock's inode, token, PID, and process-start identity; the same identities are rechecked before child creation, status publication, signalling, and cleanup;
- a dead owner or a live PID with a different process-start identity is stale and is atomically renamed only after its observed inode is rechecked; PID reuse never authorizes signalling;
- the newest five verified stale locks are retained as mode-0600 quarantine metadata and older entries are pruned; a matching stale ready record is removed with its lock;
- token or inode replacement makes the current owner fail closed; only the exact verified owner may remove the active lock and ready record;
- unknown PIDs and listeners are never killed;
- a remote bind collision makes SSH exit through `ExitOnForwardFailure`; it does not authorize eviction.

Each SSH child enters its own process group through a tiny Perl `setpgrp` exec helper. The helper writes a mode-0600 handshake before exec. The supervisor records or signals the PGID only after proving the handshake PGID equals the spawned PID and, while the child is live, matches `ps`. This avoids the post-spawn race where an early `ps` can still see the supervisor's process group.

### Unexpected exit, deliberate stop, and crash

Every SSH exit is unexpected unless the supervisor is already stopping. Exit zero, exit 255, other exits, and signals are classified as metadata and enter the retry policy.

A deliberate stop uses launchd ownership:

1. `launchctl bootout gui/$UID/com.takode.relay-tunnel`
2. launchd sends TERM to the supervisor.
3. The supervisor records `stopping`, TERM/waits the verified child group, escalates to KILL only for that same group, records `stopped`, removes only its own token, and exits zero.

Do not signal a child directly and do not use `kickstart -k` as a reload shortcut. A deliberate reload is bootout, verification that the owned child/listener cleared, bootstrap of the validated plist, then `launchctl kickstart -p gui/$UID/com.takode.relay-tunnel` if an explicit start is still needed.

Unexpected wrapper errors exit nonzero so `KeepAlive.SuccessfulExit=false` lets launchd restart after its fixed throttle. Fatal configuration, identity, or ownership validation records a visible paused/rejected state and exits zero, preventing a restart loop.

### Retry and restart-storm limits

Unexpected SSH exits retry after 2, 4, 8, 16, then 30 seconds capped. A child stable for 120 seconds resets the attempt schedule.

Wrapper and child start histories are atomic mode-0600 state. Eight quick starts within five minutes trigger a persisted five-minute cooldown. A launchd restart cannot reset this circuit. After cooldown the histories reset and bounded retries resume, so a long network outage is rate-limited rather than permanently disabled.

The LaunchAgent uses `ThrottleInterval=10` as a second guard against wrapper crash loops. It does not use launchd `NetworkState`, which macOS documents as unimplemented. The GUI agent starts at login, is cleanly removed at logout, and stays resident across sleep; encrypted SSH client/server keepalives are the liveness signal after wake or network change. Pre-login service would require a separate LaunchDaemon and key design and is not covered.

## Status and metadata-only logs

`state/status.json` is replaced atomically at mode 0600. Its fixed schema contains only:

- schema version and state;
- owner token and supervisor/child PID+PGID;
- attempt, classified exit, uptime, and backoff;
- health code/duration from a bounded sample after each verified child start;
- runtime-config fingerprint.

The health sample is evidence only; it never authorizes a restart or process cleanup. The runtime URL, host, ports, key/config paths, SSH arguments, prompts, credentials, payloads, and application content are never written to status or event logs. Events use the same bounded metadata vocabulary through macOS unified logging with tag `com.takode.relay-tunnel`.

Read-only status commands:

```bash
launchctl print "gui/$UID/com.takode.relay-tunnel"
cat "$HOME/Library/Application Support/Takode/relay-tunnel/state/status.json"
log show --last 30m --predicate 'eventMessage CONTAINS "component=com.takode.relay-tunnel"'
```

Do not paste runtime config, SSH command lines, or private key diagnostics into retained artifacts.

## Repository-only validation and inactive installation

Run before review:

```bash
/bin/bash -n scripts/relay-tunnel-supervisor.sh
plutil -lint scripts/com.takode.relay-tunnel.plist.template
cd web && bun --no-install run test -- scripts/relay-tunnel-supervisor.test.ts
```

An approved Execute may create the runtime directories, copy the reviewed script/config, render the plist, set modes, compare checksums, and run `bash -n`/`plutil -lint` while everything remains inactive. Inactive installation must stop before `launchctl bootstrap`, before signalling the current owner, and before any relay or sshd change.

## Approval-gated Execute boundary

The current production owner remains authoritative until the separately approved Execute packet begins. That packet must hold the relay lease and maintain two independent control paths.

### Preflight and disposable validation

1. Inventory exact local watcher/autossh/SSH PIDs and process groups, remote listener owners, current health, launchd state, file modes/checksums, and both ordinary and IAP access.
2. Create timestamped mode-safe backups of every path to be changed. Validate both current and candidate sshd configurations and the full rollback command sequence.
3. Install reviewed artifacts inactive and prove the sparse-environment SSH preflight.
4. If approved, apply dedicated-relay sshd 15x2, validate, reload sshd only, then re-prove existing/fresh ordinary and IAP access.
5. Bootstrap a separate validation label against disposable local/remote application ports from the approved packet. It must have no monitor listener.
6. Model a natural blackhole by SIGSTOP only on that connection's inventoried `nc` ProxyCommand. Require one owner, metadata-only evidence, recovery within 45 seconds, and a 60-second hard stop. Trap SIGCONT and remove the disposable label, child group, state, backend, and listeners.

### Transactional production cutover

Only after disposable validation passes:

1. Stop the inventoried tmux watcher through its documented owner.
2. Require its exact process group and both old application/monitor listeners to clear. Never kill a newly discovered or unverified process.
3. Bootstrap the validated production LaunchAgent.
4. Require exactly one supervisor, one verified direct-SSH child, one application listener, no fixed monitor listener, and healthy HTTPS/WebSocket within 30 seconds.
5. Validate a deliberate bootout/bootstrap reload and read-only status/log evidence. Do not blackhole the production child.

### Stop conditions and rollback

Stop immediately on any syntax, mode, identity, sparse-auth, access, sshd reload, owner, listener, handshake, duplicate, restart-storm, privacy, recovery, health, or rollback-verification failure; on repeated 5xx; or on worse connectivity.

Rollback is transactional:

1. Boot out the new validation/production labels.
2. Reap only their recorded owner-token child groups and verify the new application listener clears.
3. Restore the prior runtime/plist state and dedicated-relay sshd configuration; validate and reload sshd only.
4. Restart the original documented tmux/autossh owner.
5. Prove exactly the former application plus monitor listener ownership, ordinary/IAP access, and HTTP/HTTPS/WebSocket health.
6. Preserve metadata-only logs and record whether rollback was complete.

## Retained evidence and cleanup ownership

Do not remove the predecessor evidence or relay root backups during Implement or Execute:

- `~/.companion/execute-artifacts/relay-hardening-20260801T213159Z`
- `~/.companion/execute-artifacts/relay-strategy1-20260801T233116Z`
- `/var/backups/takode-sshd_config.20260801T213159Z.before`
- `/var/backups/takode-sshd_config.20260801T233116Z.before`

Successful cutover does not itself authorize cleanup. Outcome Review must accept recovery and rollback evidence first. Final Memory then decides whether new backups supersede these paths; preserve them by default when that decision is not explicit.
