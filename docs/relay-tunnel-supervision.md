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
    events.log                         # 0600, canonical bounded event ledger

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
HEALTHCHECK_URL=<local-destination-health-endpoint>
```

The runtime config and SSH config must be owned by the current user and mode 0600; the identity must be current-user-owned and mode 0600 or 0400. The state directory must already be current-user-owned mode 0700, or its trusted parent must exist so the supervisor can create the final directory at 0700. The supervisor rejects direct symlinks, symlinked ancestry, unsafe writable ancestry, wrong ownership, and wrong modes without repairing them in place. State-path trust failures leave the untrusted path untouched and report on stderr because writing status there would violate the same boundary. Other fatal trust/config failures record `paused_fatal` and exit zero. Unknown, duplicate, malformed, relative-path, unreadable, or unsafe values likewise pause cleanly instead of entering a launchd restart loop.

The production SSH child always uses absolute `/usr/bin/ssh` with:

- foreground `-N` operation and one explicit reverse forward;
- `BatchMode=yes`, `ConnectTimeout=10`, and `StrictHostKeyChecking=yes`;
- `ServerAliveInterval=10`, `ServerAliveCountMax=3`, and `TCPKeepAlive=no`;
- `ExitOnForwardFailure=yes`, `ControlMaster=no`, and explicit `ClearAllForwardings=no`;
- `IdentitiesOnly=yes`, `IdentityAgent=none`, `AddKeysToAgent=no`, and the explicit config/identity paths;
- a sparse environment containing only HOME, fixed system PATH, USER, and LOGNAME.

Before every child start, including retries, the supervisor revalidates runtime-config, SSH-config, and identity ancestry/ownership/modes; requires their startup inode and SHA-256 identities to remain unchanged; renders the exact argument array through offline `/usr/bin/ssh -G`; and rechecks the pinned identities after rendering. It requires exactly the configured remote forward, no local or dynamic forwards, and `clearallforwardings no`. A replaced, symlinked, permission-changed, or materially changed trusted input, or a forward inherited from the explicit SSH config, records metadata-only `paused_fatal` and exits zero before another SSH child starts. This preserves the command-line `-R` while preventing retries from silently changing forwarding or authentication behavior.

Runtime values are parsed once and remain stable for the wrapper lifetime. Editing the installed runtime config, SSH config, or identity is not a live reload mechanism. After validating intended changes, the deliberate reload is bootout, verification that the owned child/listener cleared, bootstrap of the validated plist, then an explicit start if needed. Validate the selected identity and known-host state in the same sparse environment before activation. The supervisor never prompts.

Use a local destination URL such as `http://127.0.0.1:<local-port>/api/health` for `HEALTHCHECK_URL`. This one-shot sample records whether the destination was ready when a child started; it is not an end-to-end tunnel verdict. A relay HTTPS URL can race the reverse forward that was just created and permanently record a false zero. Keep relay HTTPS and WebSocket checks as independent external acceptance gates.

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

## Status and metadata-only events

`state/status.json` is replaced atomically at mode 0600. Its fixed schema contains only:

- schema version and state;
- owner token and supervisor/child PID+PGID;
- attempt, classified exit, uptime, and backoff;
- health code/duration from a bounded sample after each verified child start;
- runtime-config fingerprint.

The health sample is evidence only; it never authorizes a restart or process cleanup. The runtime URL, host, ports, key/config paths, SSH arguments, prompts, credentials, commands, payloads, and application content are never written to status or event logs.

The canonical production event sink is `state/events.log`. Only the verified owner writes it, using no-follow append semantics inside the trusted mode-0700 state directory. The current mode-0600 file is limited to 256 KiB and rotates atomically through `events.log.1`, `.2`, and `.3`; no other event-ledger paths are accepted. Every line contains only the same fixed fields already used by status/event metadata: component/schema, event/state, attempt/exit/backoff, health code/duration, owner token, supervisor/child PID+PGID, and config fingerprint.

The supervisor also attempts the same line through macOS `logger` with tag `com.takode.relay-tunnel`. That unified-log mirror is best-effort: some macOS installations do not expose `logger` messages through `log show`, so operators must use the state-local ledger as the reliable source.

Read-only status commands:

```bash
launchctl print "gui/$UID/com.takode.relay-tunnel"
cat "$HOME/Library/Application Support/Takode/relay-tunnel/state/status.json"
tail -n 100 "$HOME/Library/Application Support/Takode/relay-tunnel/state/events.log"
# Optional best-effort mirror:
log show --last 30m --info --predicate 'eventMessage CONTAINS "component=com.takode.relay-tunnel"'
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
4. Use the absolute-deadline readiness monitor below. Require its first coherent edge within 30 wall-clock seconds: exactly one supervisor, one verified direct-SSH child, one application listener, no fixed monitor listener, local sample health, and upstream health. Then check HTTPS/WebSocket independently.
5. Validate a deliberate bootout/bootstrap reload and read-only status/log evidence. Do not blackhole the production child.

### Thirty-second wall-clock readiness evidence

Iteration counts are not time bounds: SSH connection attempts and remote health probes can make “30 polls” take much longer than 30 seconds. Use an epoch deadline, probes individually bounded to one second, and a retained metadata-only trace. The first coherent observation is accepted only when its observation timestamp is at or before the deadline.

Set `EVIDENCE_DIR`, `STATE_FILE`, `LAUNCHD_LABEL`, `PLIST_PATH`, `SUPERVISOR_PATH`, `CONFIG_PATH`, `STATE_DIR`, `RELAY_HOST`, `RELAY_APPLICATION_PORT`, and `RELAY_MONITOR_PORT` from the approved packet. Establish the deadline immediately before bootstrap so process launch time is included, then use this shape:

```bash
attempt_utc=$(date -u +%Y%m%dT%H%M%SZ)
attempt_token=$(uuidgen | tr '[:upper:]' '[:lower:]')
case "$attempt_token" in
  ""|*[!a-z0-9-]*) echo "invalid readiness attempt token" >&2; exit 1 ;;
esac
attempt_dir="$EVIDENCE_DIR/readiness-attempt-$attempt_utc-$attempt_token"
umask 077
mkdir -m 700 "$attempt_dir" || { echo "readiness attempt path already exists" >&2; exit 1; }

started_epoch=$(date +%s)
deadline=$(( started_epoch + 30 ))
trace="$attempt_dir/readiness.tsv"
first_ready="$attempt_dir/readiness.first-ready.tsv"
first_ready_tmp="$attempt_dir/.readiness.first-ready.tmp"
[ ! -e "$trace" ] && [ ! -e "$first_ready" ] && [ ! -e "$first_ready_tmp" ] || {
  echo "readiness attempt path is not empty" >&2
  exit 1
}
trace_header=$(printf 'started_epoch\tdeadline\tobserved_epoch\tobserved_utc\tfirst_ready_epoch\tlaunchd_pid\tstatus_supervisor_pid\tactual_child_ppid\tchild_pid\tchild_pgid\tactual_child_pgid\tsupervisor_count\tchild_count\tapp_listeners\tmonitor_listeners\tapp_owner_pid\tapp_owner_type\tapp_owner_is_sshd\tstatus_state\tlocal_health\tupstream_health\tcoherent')
printf '%s\n' "$trace_header" > "$trace"
chmod 600 "$trace"
first_ready_epoch=0
printf 'readiness_attempt=%s\n' "$attempt_dir"
launchctl bootstrap "gui/$UID" "$PLIST_PATH"

while :; do
  poll_started=$(date +%s)
  [ "$poll_started" -gt "$deadline" ] && break

  launchd_pid=$(launchctl print "gui/$UID/$LAUNCHD_LABEL" 2>/dev/null | awk '/pid =/ {print $3; exit}')
  status_supervisor_pid=$(jq -r '.supervisorPid // 0' "$STATE_FILE" 2>/dev/null || printf 0)
  child_pid=$(jq -r '.childPid // 0' "$STATE_FILE" 2>/dev/null || printf 0)
  child_pgid=$(jq -r '.childPgid // 0' "$STATE_FILE" 2>/dev/null || printf 0)
  actual_child_ppid=$(ps -o ppid= -p "$child_pid" 2>/dev/null | tr -d ' ')
  actual_child_pgid=$(ps -o pgid= -p "$child_pid" 2>/dev/null | tr -d ' ')
  expected_supervisor="/bin/bash $SUPERVISOR_PATH $CONFIG_PATH $STATE_DIR"
  supervisor_count=$(ps -axo command= | awk -v expected="$expected_supervisor" '$0 == expected { count += 1 } END { print count + 0 }')
  if [ "$status_supervisor_pid" != 0 ]; then
    child_count=$(pgrep -P "$status_supervisor_pid" -f '^/usr/bin/ssh ' 2>/dev/null | awk 'NF { count += 1 } END { print count + 0 }')
  else
    child_count=0
  fi
  status_state=$(jq -r '.state // "missing"' "$STATE_FILE" 2>/dev/null || printf missing)
  local_health=$(jq -r '.healthCode // 0' "$STATE_FILE" 2>/dev/null || printf 0)
  remote=$(ssh -o BatchMode=yes -o ConnectTimeout=1 -o ClearAllForwardings=yes "$RELAY_HOST" \
    "rows=\$(sudo -n ss -H -ltnp 'sport = :$RELAY_APPLICATION_PORT' || true); \
     a=\$(printf '%s\\n' \"\$rows\" | awk 'NF { count += 1 } END { print count + 0 }'); \
     m=\$(sudo -n ss -H -ltn 'sport = :$RELAY_MONITOR_PORT' | awk 'NF { count += 1 } END { print count + 0 }'); \
     owner_pid=\$(printf '%s\\n' \"\$rows\" | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p'); \
     owner_type=\$(printf '%s\\n' \"\$rows\" | sed -n 's/.*users:((\"\([A-Za-z0-9_.-][A-Za-z0-9_.-]*\)\".*/\1/p'); \
     owner_is_sshd=0; [ \"\$owner_type\" = sshd ] && owner_is_sshd=1; \
     h=\$(curl -fsS --max-time 1 -o /dev/null -w '%{http_code}' 'http://127.0.0.1:$RELAY_APPLICATION_PORT/api/health' 2>/dev/null || true); \
     printf '%s %s %s %s %s %s\\n' \"\$a\" \"\$m\" \"\${owner_pid:-0}\" \"\${owner_type:-unknown}\" \"\$owner_is_sshd\" \"\$h\"" \
    2>/dev/null || printf '9 9 0 unknown 0 000')
  set -- $remote

  observed_epoch=$(date +%s)
  observed_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  coherent=0
  if [ -n "$launchd_pid" ] && [ "$launchd_pid" = "$status_supervisor_pid" ] &&
    [ "$actual_child_ppid" = "$status_supervisor_pid" ] && [ "$supervisor_count" = 1 ] && [ "$child_count" = 1 ] &&
    [ "$child_pid" = "$child_pgid" ] && [ "$child_pid" = "$actual_child_pgid" ] && [ "$child_pid" != 0 ] &&
    [ "$status_state" = running ] && [ "$local_health" = 200 ] && [ "$1" = 1 ] && [ "$2" = 0 ] &&
    [ "$3" -gt 0 ] 2>/dev/null && [ "$4" = sshd ] && [ "$5" = 1 ] && [ "$6" = 200 ]; then
    coherent=1
  fi
  if [ "$coherent" = 1 ] && [ "$observed_epoch" -le "$deadline" ]; then
    first_ready_epoch=$observed_epoch
  fi
  poll_row=$(printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s' \
    "$started_epoch" "$deadline" "$observed_epoch" "$observed_utc" "$first_ready_epoch" \
    "${launchd_pid:-0}" "$status_supervisor_pid" "${actual_child_ppid:-0}" "$child_pid" "$child_pgid" \
    "${actual_child_pgid:-0}" "$supervisor_count" "$child_count" "$1" "$2" "$3" "$4" "$5" \
    "$status_state" "$local_health" "$6" "$coherent")
  printf '%s\n' "$poll_row" >> "$trace"

  if [ "$first_ready_epoch" -gt 0 ]; then
    (umask 077; printf '%s\n%s\n' "$trace_header" "$poll_row" > "$first_ready_tmp") || exit 1
    chmod 600 "$first_ready_tmp" || { rm -f "$first_ready_tmp"; exit 1; }
    ln "$first_ready_tmp" "$first_ready" || { rm -f "$first_ready_tmp"; exit 1; }
    rm -f "$first_ready_tmp" || true
    break
  fi
  [ "$observed_epoch" -ge "$deadline" ] && break
  sleep 0.25
done

if [ "$first_ready_epoch" -le 0 ]; then
  rm -f "$first_ready_tmp"
  [ ! -e "$first_ready" ] || { echo "unexpected first-ready artifact" >&2; exit 1; }
  echo "readiness deadline missed" >&2
  exit 1
fi
```

Use the old fixed monitor port during migration; after cutover, `RELAY_MONITOR_PORT` remains that retired port so the monitor requires it to stay absent. The timestamp-plus-UUID attempt directory is created before bootstrap and is the sole proof scope for that run; record the printed `readiness_attempt` path and never glob the evidence root or reuse another attempt as current proof. Retain each attempt trace even when readiness fails. A failed attempt has no `readiness.first-ready.tsv`; a successful attempt publishes it without clobbering through a same-directory temporary inode and hard link. The accepted artifact repeats the immutable header and complete row, including its start, deadline, observation, first-ready, owner, listener, state, and health fields, so the 30-second predicate can be audited without shell state or another file. Record HTTPS, WebSocket, ordinary/IAP access, and 5xx checks as separate evidence after the coherent edge; do not fold slow end-to-end probes into the readiness loop.

### Stop conditions and rollback

Stop immediately on any syntax, mode, identity, sparse-auth, access, sshd reload, owner, listener, handshake, duplicate, restart-storm, privacy, recovery, health, or rollback-verification failure; when the retained trace has no coherent edge at or before its absolute deadline; on repeated 5xx; or on worse connectivity. Never infer a deadline miss from an iteration count alone.

Rollback is transactional:

1. Boot out the new validation/production labels.
2. Reap only their recorded owner-token child groups and verify the new application listener clears.
3. Restore the prior runtime/plist state and dedicated-relay sshd configuration; validate and reload sshd only.
4. Restart the original documented tmux/autossh owner.
5. Use a separate absolute-deadline trace with short probes to record the first coherent restored-owner/listener edge. Prove exactly the former application plus monitor listener ownership, then check ordinary/IAP access and HTTP/HTTPS/WebSocket health independently.
6. Preserve `status.json`, the bounded event ledger, readiness/rollback traces, and whether rollback was complete.

## Retained evidence and cleanup ownership

Do not remove the predecessor evidence or relay root backups during Implement or Execute:

- `~/.companion/execute-artifacts/relay-hardening-20260801T213159Z`
- `~/.companion/execute-artifacts/relay-strategy1-20260801T233116Z`
- `~/.companion/execute-artifacts/relay-supervision-cutover-20260802T064822Z`
- `/var/backups/takode-sshd_config.20260801T213159Z.before`
- `/var/backups/takode-sshd_config.20260801T233116Z.before`
- `/var/backups/takode-sshd_config.20260802T064822Z.before`

Successful cutover does not itself authorize cleanup. Outcome Review must accept recovery and rollback evidence first. Final Memory then decides whether new backups supersede these paths; preserve them by default when that decision is not explicit.
