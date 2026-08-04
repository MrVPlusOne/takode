#!/bin/bash
# Foreground monitor-free reverse-SSH supervisor for a macOS user LaunchAgent.
#
# Usage: relay-tunnel-supervisor.sh <runtime-config> <state-directory>
#
# The runtime config is a mode-0600 KEY=VALUE file. The state directory is
# mode 0700. This process stays in the foreground; launchd owns this process,
# and this process owns exactly one foreground SSH child process group.

# Trap callbacks are indirect entry points, and the single-quoted snippets are
# Perl programs whose dollar expressions must not be expanded by Bash.
# shellcheck disable=SC2329,SC2016

set -u

SCHEMA_VERSION=1
COMPONENT="com.takode.relay-tunnel"
CONFIG_PATH=${1:-}
STATE_DIR=${2:-}

SSH_BIN="/usr/bin/ssh"
ENV_BIN="/usr/bin/env"
PERL_BIN="/usr/bin/perl"
LOGGER_BIN="/usr/bin/logger"
SHASUM_BIN="/usr/bin/shasum"
ID_BIN="/usr/bin/id"
CURL_BIN="/usr/bin/curl"
AWK_BIN="/usr/bin/awk"

BACKOFF_SECONDS=(2 4 8 16 30)
STABLE_RESET_SECONDS=120
QUICK_START_WINDOW_SECONDS=300
QUICK_START_LIMIT=8
COOLDOWN_SECONDS=300
HANDSHAKE_WAIT_TICKS=200
HANDSHAKE_TICK_SECONDS=0.01
CHILD_TERM_TICKS=50
CHILD_TERM_TICK_SECONDS=0.1
OWNER_PROTOCOL_VERSION=1
OWNER_CONTENTION_TICKS=200
OWNER_CONTENTION_TICK_SECONDS=0.01
OWNER_QUARANTINE_LIMIT=5
EVENT_MAX_BYTES=262144
EVENT_ROTATION_COUNT=3

TESTING=${TAKODE_RELAY_SUPERVISOR_TESTING:-0}
TEST_CHILD=${TAKODE_RELAY_SUPERVISOR_TEST_CHILD:-}
TEST_STATE=${TAKODE_RELAY_SUPERVISOR_TEST_STATE:-}
TEST_LOG_FILE=${TAKODE_RELAY_SUPERVISOR_TEST_LOG_FILE:-}
TEST_MAX_CHILD_EXITS=${TAKODE_RELAY_SUPERVISOR_TEST_MAX_CHILD_EXITS:-0}
TEST_HANDSHAKE_FAIL=${TAKODE_RELAY_SUPERVISOR_TEST_HANDSHAKE_FAIL:-0}
TEST_HEALTH_RESULT=${TAKODE_RELAY_SUPERVISOR_TEST_HEALTH_RESULT:-}
TEST_OWNER_INIT_DELAY=${TAKODE_RELAY_SUPERVISOR_TEST_OWNER_INIT_DELAY:-0}
TEST_LOGGER_BIN=${TAKODE_RELAY_SUPERVISOR_TEST_LOGGER_BIN:-}
TEST_BACKOFF_READY_FILE=${TAKODE_RELAY_SUPERVISOR_TEST_BACKOFF_READY_FILE:-}
TEST_BACKOFF_RELEASE_FILE=${TAKODE_RELAY_SUPERVISOR_TEST_BACKOFF_RELEASE_FILE:-}
TEST_BACKOFF_GATE_TICKS=${TAKODE_RELAY_SUPERVISOR_TEST_BACKOFF_GATE_TICKS:-200}
TEST_BACKOFF_GATE_TICK_SECONDS=${TAKODE_RELAY_SUPERVISOR_TEST_BACKOFF_GATE_TICK_SECONDS:-0.01}
CURRENT_UID=$($ID_BIN -u 2>/dev/null || printf '')
RUNTIME_USER=${USER:-$($ID_BIN -un 2>/dev/null || true)}
RUNTIME_LOGNAME=${LOGNAME:-$RUNTIME_USER}

if [ "$TESTING" = "1" ]; then
  if [ -n "${TAKODE_RELAY_SUPERVISOR_TEST_BACKOFFS:-}" ]; then
    IFS=',' read -r -a BACKOFF_SECONDS <<< "$TAKODE_RELAY_SUPERVISOR_TEST_BACKOFFS"
  fi
  STABLE_RESET_SECONDS=${TAKODE_RELAY_SUPERVISOR_TEST_STABLE_SECONDS:-$STABLE_RESET_SECONDS}
  QUICK_START_WINDOW_SECONDS=${TAKODE_RELAY_SUPERVISOR_TEST_WINDOW_SECONDS:-$QUICK_START_WINDOW_SECONDS}
  QUICK_START_LIMIT=${TAKODE_RELAY_SUPERVISOR_TEST_START_LIMIT:-$QUICK_START_LIMIT}
  COOLDOWN_SECONDS=${TAKODE_RELAY_SUPERVISOR_TEST_COOLDOWN_SECONDS:-$COOLDOWN_SECONDS}
  HANDSHAKE_WAIT_TICKS=${TAKODE_RELAY_SUPERVISOR_TEST_HANDSHAKE_TICKS:-$HANDSHAKE_WAIT_TICKS}
  CHILD_TERM_TICKS=${TAKODE_RELAY_SUPERVISOR_TEST_TERM_TICKS:-$CHILD_TERM_TICKS}
  CHILD_TERM_TICK_SECONDS=${TAKODE_RELAY_SUPERVISOR_TEST_TERM_TICK_SECONDS:-$CHILD_TERM_TICK_SECONDS}
  OWNER_CONTENTION_TICKS=${TAKODE_RELAY_SUPERVISOR_TEST_OWNER_CONTENTION_TICKS:-$OWNER_CONTENTION_TICKS}
  OWNER_CONTENTION_TICK_SECONDS=${TAKODE_RELAY_SUPERVISOR_TEST_OWNER_CONTENTION_TICK_SECONDS:-$OWNER_CONTENTION_TICK_SECONDS}
  OWNER_QUARANTINE_LIMIT=${TAKODE_RELAY_SUPERVISOR_TEST_QUARANTINE_LIMIT:-$OWNER_QUARANTINE_LIMIT}
  EVENT_MAX_BYTES=${TAKODE_RELAY_SUPERVISOR_TEST_EVENT_MAX_BYTES:-$EVENT_MAX_BYTES}
fi

umask 077

OWNER_LOCK=""
OWNER_TOKEN=""
OWNER_ACQUIRED=0
OWNER_INODE=""
OWNER_START_IDENTITY=""
SELF_START_IDENTITY=""
OWNER_METADATA_FILE=""
OBSERVED_OWNER_PROTOCOL=""
OBSERVED_OWNER_PHASE=""
OBSERVED_OWNER_PID=""
OBSERVED_OWNER_TOKEN=""
OBSERVED_OWNER_START_IDENTITY=""
OBSERVED_OWNER_INODE=""
WRAPPER_STARTED_AT=$(date +%s)
CHILD_PID=""
CHILD_PGID=""
CHILD_HANDSHAKE_FILE=""
CHILD_STARTED_AT=0
STOPPING=0
ATTEMPT=0
CHILD_EXIT_COUNT=0
CURRENT_STATE="starting"
LAST_EXIT_CLASS="none"
CURRENT_BACKOFF="0"
CONFIG_FINGERPRINT="unavailable"
CONFIG_INODE=""
SSH_CONFIG_FINGERPRINT=""
SSH_CONFIG_INODE=""
SSH_IDENTITY_FINGERPRINT=""
SSH_IDENTITY_INODE=""
HEALTH_CODE="null"
HEALTH_DURATION_MS="null"
COOLDOWN_COMPLETED=0
EVENT_SINK_READY=0

SSH_HOST=""
SSH_CONFIG_FILE=""
SSH_IDENTITY_FILE=""
REMOTE_BIND_HOST=""
REMOTE_PORT=""
LOCAL_HOST=""
LOCAL_PORT=""
HEALTHCHECK_URL=""
SSH_ARGUMENTS=()

STATUS_FILE=""
WRAPPER_HISTORY_FILE=""
CHILD_HISTORY_FILE=""
COOLDOWN_FILE=""
EVENT_FILE=""

is_unsigned_integer() {
  case "$1" in
    ""|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

is_positive_integer() {
  is_unsigned_integer "$1" && [ "$1" -gt 0 ]
}

is_safe_endpoint() {
  case "$1" in
    ""|*[!A-Za-z0-9._:-]*) return 1 ;;
    *) return 0 ;;
  esac
}

absolute_path() {
  case "$1" in
    /*) return 0 ;;
    *) return 1 ;;
  esac
}

file_mode() {
  local raw
  if stat -f '%p' "$1" >/dev/null 2>&1; then
    raw=$(stat -f '%p' "$1") || return 1
    printf '%o\n' $((8#$raw & 07777))
  else
    stat -c '%a' "$1"
  fi
}

file_owner_uid() {
  if stat -f '%u' "$1" >/dev/null 2>&1; then
    stat -f '%u' "$1"
  else
    stat -c '%u' "$1"
  fi
}

path_inode() {
  if stat -f '%i' "$1" >/dev/null 2>&1; then
    stat -f '%i' "$1"
  else
    stat -c '%i' "$1"
  fi
}

path_is_trusted_ancestry() {
  local path
  path=$1
  absolute_path "$path" || return 1
  case "$path" in
    *//*|*/./*|*/../*|*/.|*/..|*[\*\?\[]*|*$'\n'*|*$'\r'*) return 1 ;;
  esac
  "$PERL_BIN" -e '
    use strict;
    use warnings;
    my ($path, $current_uid) = @ARGV;
    exit 1 unless defined($path) && $path =~ m{\A/};
    my @components = grep { length($_) } split(m{/}, $path);
    my $current = "";
    for my $component (@components) {
      $current .= "/" . $component;
      my @stat = lstat($current);
      if (!@stat) {
        exit($current eq $path ? 0 : 1);
      }
      exit 1 if -l _;
      my $owner = $stat[4];
      exit 1 if $owner != $current_uid && $owner != 0;
      if (-d _) {
        my $mode = $stat[2] & 07777;
        exit 1 if ($mode & 0022) && !($owner == 0 && ($mode & 01000));
      }
    }
    exit 0;
  ' "$path" "$CURRENT_UID"
}

process_start_identity() {
  local pid start
  pid=$1
  is_unsigned_integer "$pid" || return 1
  start=$(ps -o lstart= -p "$pid" 2>/dev/null | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  [ -n "$start" ] || return 1
  printf '%s' "$pid:$start" | "$SHASUM_BIN" -a 256 | awk '{print $1}'
}

file_fingerprint() {
  "$SHASUM_BIN" -a 256 "$1" 2>/dev/null | awk '{print $1}'
}

file_size() {
  if stat -f '%z' "$1" >/dev/null 2>&1; then
    stat -f '%z' "$1"
  else
    stat -c '%s' "$1"
  fi
}

read_owner_metadata() {
  local metadata_path line key value seen
  metadata_path=$1
  OBSERVED_OWNER_PROTOCOL=""
  OBSERVED_OWNER_PHASE=""
  OBSERVED_OWNER_PID=""
  OBSERVED_OWNER_TOKEN=""
  OBSERVED_OWNER_START_IDENTITY=""
  OBSERVED_OWNER_INODE=""
  [ -f "$metadata_path" ] && [ ! -L "$metadata_path" ] || return 1
  [ "$(file_owner_uid "$metadata_path" 2>/dev/null || true)" = "$CURRENT_UID" ] || return 1
  [ "$(file_mode "$metadata_path" 2>/dev/null || true)" = "600" ] || return 1
  seen="|"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in *=*) key=${line%%=*}; value=${line#*=} ;; *) return 1 ;; esac
    case "$seen" in *"|$key|"*) return 1 ;; esac
    seen="${seen}${key}|"
    case "$key" in
      protocol) OBSERVED_OWNER_PROTOCOL=$value ;;
      phase) OBSERVED_OWNER_PHASE=$value ;;
      pid) OBSERVED_OWNER_PID=$value ;;
      token) OBSERVED_OWNER_TOKEN=$value ;;
      start_identity) OBSERVED_OWNER_START_IDENTITY=$value ;;
      lock_inode) OBSERVED_OWNER_INODE=$value ;;
      *) return 1 ;;
    esac
  done < "$metadata_path"
  [ "$OBSERVED_OWNER_PROTOCOL" = "$OWNER_PROTOCOL_VERSION" ] &&
    { [ "$OBSERVED_OWNER_PHASE" = "initializing" ] || [ "$OBSERVED_OWNER_PHASE" = "ready" ]; } &&
    is_unsigned_integer "$OBSERVED_OWNER_PID" && [ -n "$OBSERVED_OWNER_TOKEN" ] &&
    [[ "$OBSERVED_OWNER_TOKEN" != *[!A-Za-z0-9._-]* ]] &&
    [ ${#OBSERVED_OWNER_START_IDENTITY} -eq 64 ] && is_unsigned_integer "$OBSERVED_OWNER_INODE"
}

verify_owner_lock_initializing() {
  local inode
  [ "$OWNER_ACQUIRED" -eq 1 ] && [ -f "$OWNER_LOCK" ] && [ ! -L "$OWNER_LOCK" ] || return 1
  inode=$(path_inode "$OWNER_LOCK" 2>/dev/null) || return 1
  [ "$inode" = "$OWNER_INODE" ] || return 1
  read_owner_metadata "$OWNER_LOCK" || return 1
  [ "$OBSERVED_OWNER_PHASE" = "initializing" ] &&
    [ "$OBSERVED_OWNER_PID" = "$$" ] && [ "$OBSERVED_OWNER_TOKEN" = "$OWNER_TOKEN" ] &&
    [ "$OBSERVED_OWNER_START_IDENTITY" = "$OWNER_START_IDENTITY" ] &&
    [ "$OBSERVED_OWNER_INODE" = "$OWNER_INODE" ]
}

verify_current_owner() {
  verify_owner_lock_initializing || return 1
  read_owner_metadata "$OWNER_METADATA_FILE" || return 1
  [ "$OBSERVED_OWNER_PHASE" = "ready" ] &&
    [ "$OBSERVED_OWNER_PID" = "$$" ] && [ "$OBSERVED_OWNER_TOKEN" = "$OWNER_TOKEN" ] &&
    [ "$OBSERVED_OWNER_START_IDENTITY" = "$OWNER_START_IDENTITY" ] &&
    [ "$OBSERVED_OWNER_INODE" = "$OWNER_INODE" ]
}

verify_current_process_identity() {
  [ -n "$SELF_START_IDENTITY" ] && [ "$SELF_START_IDENTITY" = "$OWNER_START_IDENTITY" ]
}

atomic_write_lines() {
  local destination temporary line
  destination=$1
  shift
  temporary="$STATE_DIR/.write.$$.${RANDOM}"
  : > "$temporary" || return 1
  chmod 600 "$temporary" || return 1
  for line in "$@"; do
    printf '%s\n' "$line" >> "$temporary" || return 1
  done
  mv -f "$temporary" "$destination"
}

json_number_or_null() {
  if [ -n "$1" ]; then printf '%s' "$1"; else printf 'null'; fi
}

write_status() {
  local state exit_class backoff now uptime child_pid_json child_pgid_json temporary
  if [ "$OWNER_ACQUIRED" -eq 1 ] && ! verify_current_owner; then return 1; fi
  state=$1
  exit_class=$2
  backoff=$3
  now=$(date +%s)
  uptime=$((now - WRAPPER_STARTED_AT))
  child_pid_json=$(json_number_or_null "$CHILD_PID")
  child_pgid_json=$(json_number_or_null "$CHILD_PGID")
  temporary="$STATE_DIR/.status.$$.${RANDOM}"
  cat > "$temporary" <<EOF
{
  "schemaVersion": $SCHEMA_VERSION,
  "state": "$state",
  "ownerToken": "$OWNER_TOKEN",
  "supervisorPid": $$,
  "childPid": $child_pid_json,
  "childPgid": $child_pgid_json,
  "attempt": $ATTEMPT,
  "exitClass": "$exit_class",
  "uptimeSeconds": $uptime,
  "backoffSeconds": $backoff,
  "healthCode": $HEALTH_CODE,
  "healthDurationMs": $HEALTH_DURATION_MS,
  "configFingerprint": "$CONFIG_FINGERPRINT"
}
EOF
  chmod 600 "$temporary" || return 1
  mv -f "$temporary" "$STATUS_FILE" || return 1
  CURRENT_STATE=$state
  LAST_EXIT_CLASS=$exit_class
  CURRENT_BACKOFF=$backoff
}

emit_event() {
  local event event_line
  event=$1
  case "$event" in ""|*[!A-Za-z0-9_]*) return 1 ;; esac
  event_line="component=$COMPONENT schema=$SCHEMA_VERSION event=$event state=$CURRENT_STATE attempt=$ATTEMPT exit_class=$LAST_EXIT_CLASS backoff_seconds=$CURRENT_BACKOFF health_code=$HEALTH_CODE health_duration_ms=$HEALTH_DURATION_MS owner_token=$OWNER_TOKEN supervisor_pid=$$ child_pid=${CHILD_PID:-0} child_pgid=${CHILD_PGID:-0} config_fingerprint=$CONFIG_FINGERPRINT"
  if [ "$EVENT_SINK_READY" -eq 1 ] && ! append_event_sink "$event_line"; then
    EVENT_SINK_READY=0
  fi
  if [ "$TESTING" = "1" ] && [ -n "$TEST_LOG_FILE" ]; then
    printf '%s\n' "$event_line" >> "$TEST_LOG_FILE"
    chmod 600 "$TEST_LOG_FILE"
  fi
  if [ "$TESTING" = "1" ] && [ -x "$TEST_LOGGER_BIN" ]; then
    "$TEST_LOGGER_BIN" -t "$COMPONENT" -- "$event_line" >/dev/null 2>&1 || true
  elif [ "$TESTING" != "1" ] && [ -x "$LOGGER_BIN" ]; then
    "$LOGGER_BIN" -t "$COMPONENT" -- "$event_line" >/dev/null 2>&1 || true
  fi
}

event_file_is_trusted() {
  local path=$1
  [ -f "$path" ] && [ ! -L "$path" ] || return 1
  [ "$(file_owner_uid "$path" 2>/dev/null || true)" = "$CURRENT_UID" ] || return 1
  [ "$(file_mode "$path" 2>/dev/null || true)" = "600" ] || return 1
  [ "$(file_size "$path" 2>/dev/null || true)" -le "$EVENT_MAX_BYTES" ] 2>/dev/null
}

validate_event_sink_trust() {
  local path suffix index
  path_is_trusted_ancestry "$STATE_DIR" || return 1
  [ -d "$STATE_DIR" ] && [ ! -L "$STATE_DIR" ] || return 1
  [ "$(file_owner_uid "$STATE_DIR" 2>/dev/null || true)" = "$CURRENT_UID" ] || return 1
  [ "$(file_mode "$STATE_DIR" 2>/dev/null || true)" = "700" ] || return 1
  is_positive_integer "$EVENT_MAX_BYTES" && [ "$EVENT_MAX_BYTES" -ge 512 ] || return 1
  is_positive_integer "$EVENT_ROTATION_COUNT" || return 1
  if [ -e "$EVENT_FILE" ] || [ -L "$EVENT_FILE" ]; then event_file_is_trusted "$EVENT_FILE" || return 1; fi
  index=1
  while [ "$index" -le "$EVENT_ROTATION_COUNT" ]; do
    path="$EVENT_FILE.$index"
    if [ -e "$path" ] || [ -L "$path" ]; then event_file_is_trusted "$path" || return 1; fi
    index=$((index + 1))
  done
  for path in "$EVENT_FILE".*; do
    [ -e "$path" ] || [ -L "$path" ] || continue
    suffix=${path#"$EVENT_FILE."}
    case "$suffix" in 1|2|3) ;; *) return 1 ;; esac
  done
  return 0
}

validate_event_append_trust() {
  path_is_trusted_ancestry "$STATE_DIR" || return 1
  [ -d "$STATE_DIR" ] && [ ! -L "$STATE_DIR" ] || return 1
  [ "$(file_owner_uid "$STATE_DIR" 2>/dev/null || true)" = "$CURRENT_UID" ] || return 1
  [ "$(file_mode "$STATE_DIR" 2>/dev/null || true)" = "700" ] || return 1
  is_positive_integer "$EVENT_MAX_BYTES" && [ "$EVENT_MAX_BYTES" -ge 512 ] || return 1
  event_file_is_trusted "$EVENT_FILE"
}

initialize_event_sink() {
  validate_event_sink_trust || return 1
  if [ ! -e "$EVENT_FILE" ]; then atomic_write_lines "$EVENT_FILE" || return 1; fi
  event_file_is_trusted "$EVENT_FILE" || return 1
  EVENT_SINK_READY=1
}

rotate_event_sink() {
  local index source destination
  validate_event_sink_trust || return 1
  destination="$EVENT_FILE.$EVENT_ROTATION_COUNT"
  if [ -e "$destination" ]; then rm -f "$destination" || return 1; fi
  index=$((EVENT_ROTATION_COUNT - 1))
  while [ "$index" -ge 1 ]; do
    source="$EVENT_FILE.$index"
    destination="$EVENT_FILE.$((index + 1))"
    if [ -e "$source" ]; then mv "$source" "$destination" || return 1; fi
    index=$((index - 1))
  done
  if [ -e "$EVENT_FILE" ]; then mv "$EVENT_FILE" "$EVENT_FILE.1" || return 1; fi
  atomic_write_lines "$EVENT_FILE" || return 1
  validate_event_sink_trust
}

append_event_sink() {
  local event_line=$1 current_size line_size
  verify_current_owner || return 1
  validate_event_append_trust || return 1
  current_size=$(file_size "$EVENT_FILE") || return 1
  line_size=$((${#event_line} + 1))
  [ "$line_size" -le "$EVENT_MAX_BYTES" ] || return 1
  if [ $((current_size + line_size)) -gt "$EVENT_MAX_BYTES" ]; then rotate_event_sink || return 1; fi
  "$PERL_BIN" -MFcntl=:DEFAULT -e '
    my ($path, $uid, $line) = @ARGV;
    sysopen(my $fh, $path, O_WRONLY | O_APPEND | O_NOFOLLOW) or exit 2;
    my @stat = stat($fh);
    exit 3 unless @stat && $stat[4] == $uid && ($stat[2] & 07777) == 0600 && -f $fh;
    my $payload = "$line\n";
    my $written = syswrite($fh, $payload);
    exit 4 unless defined($written) && $written == length($payload);
    close($fh) or exit 5;
  ' "$EVENT_FILE" "$CURRENT_UID" "$event_line"
}

remove_owned_lock() {
  if [ "$OWNER_ACQUIRED" -ne 1 ]; then
    return 0
  fi
  if verify_current_owner && verify_current_process_identity; then
    rm -f "$OWNER_LOCK"
    rm -f "$OWNER_METADATA_FILE"
  fi
  OWNER_ACQUIRED=0
}

terminate_child() {
  local tick proposed_pgid actual_pgid
  if [ -z "$CHILD_PID" ]; then
    return 0
  fi

  # Ownership must still match the immutable published inode and ready record
  # before this wrapper signals even its recorded child identity.
  if ! verify_current_owner || ! verify_current_process_identity; then
    return 70
  fi

  if ! kill -0 "$CHILD_PID" 2>/dev/null; then
    wait "$CHILD_PID" 2>/dev/null || true
    if [ -n "$CHILD_HANDSHAKE_FILE" ]; then rm -f "$CHILD_HANDSHAKE_FILE"; fi
    CHILD_PID=""
    CHILD_PGID=""
    CHILD_HANDSHAKE_FILE=""
    return 0
  fi

  if [ -z "$CHILD_PGID" ] && [ -n "$CHILD_HANDSHAKE_FILE" ] && [ -s "$CHILD_HANDSHAKE_FILE" ]; then
    proposed_pgid=$(cat "$CHILD_HANDSHAKE_FILE" 2>/dev/null || true)
    actual_pgid=$(ps -o pgid= -p "$CHILD_PID" 2>/dev/null | tr -d '[:space:]')
    if is_unsigned_integer "$proposed_pgid" && [ "$proposed_pgid" = "$CHILD_PID" ] && [ "$actual_pgid" = "$proposed_pgid" ]; then
      CHILD_PGID=$proposed_pgid
    fi
  fi

  if [ -n "$CHILD_PGID" ] && [ "$CHILD_PGID" = "$CHILD_PID" ]; then
    kill -TERM -- "-$CHILD_PGID" 2>/dev/null || true
  else
    # The PID was created by this supervisor, but group identity was not yet
    # proven. Never infer or signal an unverified process group.
    kill -TERM "$CHILD_PID" 2>/dev/null || true
  fi

  tick=0
  while kill -0 "$CHILD_PID" 2>/dev/null && [ "$tick" -lt "$CHILD_TERM_TICKS" ]; do
    sleep "$CHILD_TERM_TICK_SECONDS"
    tick=$((tick + 1))
  done

  if kill -0 "$CHILD_PID" 2>/dev/null; then
    if [ -n "$CHILD_PGID" ] && [ "$CHILD_PGID" = "$CHILD_PID" ]; then
      kill -KILL -- "-$CHILD_PGID" 2>/dev/null || true
    else
      kill -KILL "$CHILD_PID" 2>/dev/null || true
    fi
  fi
  wait "$CHILD_PID" 2>/dev/null || true
  if [ -n "$CHILD_HANDSHAKE_FILE" ]; then rm -f "$CHILD_HANDSHAKE_FILE"; fi
  CHILD_PID=""
  CHILD_PGID=""
  CHILD_HANDSHAKE_FILE=""
}

deliberate_stop() {
  STOPPING=1
  write_status "stopping" "deliberate_stop" 0 || true
  emit_event "deliberate_stop"
  terminate_child
  write_status "stopped" "deliberate_stop" 0 || true
  remove_owned_lock
  exit 0
}

on_exit() {
  local status=$?
  if [ "$STOPPING" -ne 1 ] && [ "$status" -ne 0 ]; then
    write_status "crashed" "wrapper_error" 0 2>/dev/null || true
    emit_event "wrapper_error"
  fi
  remove_owned_lock
}

trap deliberate_stop TERM INT
trap on_exit EXIT

initialize_state_dir() {
  local owner mode
  if ! absolute_path "$STATE_DIR" || ! path_is_trusted_ancestry "$STATE_DIR"; then
    printf 'relay supervisor: state directory ancestry is untrusted\n' >&2
    exit 0
  fi
  if [ -e "$STATE_DIR" ]; then
    [ -d "$STATE_DIR" ] && [ ! -L "$STATE_DIR" ] || { printf 'relay supervisor: state path is not a directory\n' >&2; exit 0; }
    owner=$(file_owner_uid "$STATE_DIR" 2>/dev/null || true)
    mode=$(file_mode "$STATE_DIR" 2>/dev/null || true)
    if [ "$owner" != "$CURRENT_UID" ] || [ "$mode" != "700" ]; then
      printf 'relay supervisor: existing state directory ownership or mode is untrusted\n' >&2
      exit 0
    fi
  else
    mkdir "$STATE_DIR" || exit 70
    owner=$(file_owner_uid "$STATE_DIR" 2>/dev/null || true)
    mode=$(file_mode "$STATE_DIR" 2>/dev/null || true)
    if [ "$owner" != "$CURRENT_UID" ] || [ "$mode" != "700" ] || [ -L "$STATE_DIR" ]; then
      rmdir "$STATE_DIR" 2>/dev/null || true
      exit 0
    fi
  fi
  STATUS_FILE="$STATE_DIR/status.json"
  WRAPPER_HISTORY_FILE="$STATE_DIR/wrapper-start-history"
  CHILD_HISTORY_FILE="$STATE_DIR/child-start-history"
  COOLDOWN_FILE="$STATE_DIR/cooldown-until"
  OWNER_LOCK="$STATE_DIR/owner.lock"
  EVENT_FILE="$STATE_DIR/events.log"
}

validate_runtime_environment() {
  if ! absolute_path "${HOME:-}" || [ -z "$RUNTIME_USER" ] || [ -z "$RUNTIME_LOGNAME" ]; then
    pause_fatal "environment_invalid"
  fi
  for required_binary in "$SSH_BIN" "$ENV_BIN" "$PERL_BIN" "$SHASUM_BIN" "$ID_BIN" "$CURL_BIN" "$AWK_BIN"; do
    if [ ! -x "$required_binary" ]; then pause_fatal "runtime_binary_missing"; fi
  done
}

prune_owner_quarantines() {
  local -a entries
  local entry oldest count
  while :; do
    entries=()
    for entry in "$STATE_DIR"/owner.lock.quarantine.*; do
      [ -f "$entry" ] && [ ! -L "$entry" ] || continue
      entries+=("$entry")
    done
    count=${#entries[@]}
    [ "$count" -le "$OWNER_QUARANTINE_LIMIT" ] && return 0
    oldest=${entries[0]}
    for entry in "${entries[@]}"; do
      if [[ "$entry" < "$oldest" ]]; then oldest=$entry; fi
    done
    [ "$(file_owner_uid "$oldest" 2>/dev/null || true)" = "$CURRENT_UID" ] || return 1
    [ "$(file_mode "$oldest" 2>/dev/null || true)" = "600" ] || return 1
    rm -f "$oldest" || return 1
  done
}

quarantine_observed_owner() {
  local expected_inode quarantine moved_inode stale_ready stale_pid stale_token stale_start stale_metadata_inode
  expected_inode=$1
  [ -f "$OWNER_LOCK" ] && [ ! -L "$OWNER_LOCK" ] || return 1
  [ "$(path_inode "$OWNER_LOCK" 2>/dev/null || true)" = "$expected_inode" ] || return 1
  quarantine="$STATE_DIR/owner.lock.quarantine.$(printf '%010d' "$(date +%s)").${OWNER_TOKEN}"
  mv "$OWNER_LOCK" "$quarantine" 2>/dev/null || return 1
  moved_inode=$(path_inode "$quarantine" 2>/dev/null || true)
  if [ "$moved_inode" != "$expected_inode" ]; then
    if [ ! -e "$OWNER_LOCK" ]; then mv "$quarantine" "$OWNER_LOCK" 2>/dev/null || true; fi
    return 1
  fi
  chmod 600 "$quarantine" 2>/dev/null || return 1
  stale_pid=$OBSERVED_OWNER_PID
  stale_token=$OBSERVED_OWNER_TOKEN
  stale_start=$OBSERVED_OWNER_START_IDENTITY
  stale_metadata_inode=$OBSERVED_OWNER_INODE
  stale_ready="$STATE_DIR/owner.ready.${stale_token}"
  if [ -f "$stale_ready" ] && [ ! -L "$stale_ready" ] && read_owner_metadata "$stale_ready" &&
    [ "$OBSERVED_OWNER_PHASE" = "ready" ] && [ "$OBSERVED_OWNER_PID" = "$stale_pid" ] &&
    [ "$OBSERVED_OWNER_TOKEN" = "$stale_token" ] && [ "$OBSERVED_OWNER_START_IDENTITY" = "$stale_start" ] &&
    [ "$OBSERVED_OWNER_INODE" = "$stale_metadata_inode" ]; then
    rm -f "$stale_ready" || return 1
  fi
  prune_owner_quarantines || return 1
  emit_event "dead_owner_quarantined"
}

wait_for_owner_metadata() {
  local expected_inode tick
  expected_inode=$1
  tick=0
  while [ "$tick" -lt "$OWNER_CONTENTION_TICKS" ]; do
    [ "$(path_inode "$OWNER_LOCK" 2>/dev/null || true)" = "$expected_inode" ] || return 1
    if read_owner_metadata "$OWNER_LOCK"; then return 0; fi
    sleep "$OWNER_CONTENTION_TICK_SECONDS"
    tick=$((tick + 1))
  done
  return 1
}

publish_owner_claim() {
  local claim claim_inode
  OWNER_TOKEN=$(printf '%s' "$$:$PPID:$(date +%s):$RANDOM" | "$SHASUM_BIN" -a 256 | awk '{print $1}')
  SELF_START_IDENTITY=${SELF_START_IDENTITY:-$(process_start_identity "$$")} || return 70
  OWNER_START_IDENTITY=$SELF_START_IDENTITY
  claim="$STATE_DIR/.owner-claim.${OWNER_TOKEN}"
  : > "$claim" || return 70
  chmod 600 "$claim" || return 70
  claim_inode=$(path_inode "$claim") || return 70
  cat > "$claim" <<EOF
protocol=$OWNER_PROTOCOL_VERSION
phase=initializing
pid=$$
token=$OWNER_TOKEN
start_identity=$OWNER_START_IDENTITY
lock_inode=$claim_inode
EOF
  chmod 600 "$claim" || return 70
  [ "$(path_inode "$claim" 2>/dev/null || true)" = "$claim_inode" ] || { rm -f "$claim"; return 70; }
  if ! ln "$claim" "$OWNER_LOCK" 2>/dev/null; then rm -f "$claim"; return 1; fi
  OWNER_INODE=$(path_inode "$OWNER_LOCK" 2>/dev/null || true)
  rm -f "$claim"
  [ "$OWNER_INODE" = "$claim_inode" ] || return 70
  OWNER_ACQUIRED=1
  verify_owner_lock_initializing || return 70
  if [ "$TESTING" = "1" ] && [ "$TEST_OWNER_INIT_DELAY" != "0" ]; then sleep "$TEST_OWNER_INIT_DELAY"; fi
  verify_owner_lock_initializing || return 70
  OWNER_METADATA_FILE="$STATE_DIR/owner.ready.${OWNER_TOKEN}"
  atomic_write_lines "$OWNER_METADATA_FILE" \
    "protocol=$OWNER_PROTOCOL_VERSION" "phase=ready" "pid=$$" "token=$OWNER_TOKEN" \
    "start_identity=$OWNER_START_IDENTITY" "lock_inode=$OWNER_INODE" || return 70
  verify_current_owner && verify_current_process_identity || return 70
  return 0
}

acquire_owner() {
  local observed_inode observed_start attempt claim_status
  attempt=0
  while [ "$attempt" -lt 3 ]; do
    publish_owner_claim
    claim_status=$?
    if [ "$claim_status" -eq 0 ]; then return 0; fi
    if [ "$OWNER_ACQUIRED" -eq 1 ]; then
      emit_event "owner_publication_failed"
      exit 70
    fi
    [ -e "$OWNER_LOCK" ] || { attempt=$((attempt + 1)); continue; }
    if [ -L "$OWNER_LOCK" ] || [ ! -f "$OWNER_LOCK" ]; then
      emit_event "owner_untrusted_rejected"
      exit 0
    fi
    if [ "$(file_owner_uid "$OWNER_LOCK" 2>/dev/null || true)" != "$CURRENT_UID" ] ||
      [ "$(file_mode "$OWNER_LOCK" 2>/dev/null || true)" != "600" ]; then
      emit_event "owner_untrusted_rejected"
      exit 0
    fi
    observed_inode=$(path_inode "$OWNER_LOCK" 2>/dev/null || true)
    is_unsigned_integer "$observed_inode" || { emit_event "owner_race_rejected"; exit 0; }
    if ! wait_for_owner_metadata "$observed_inode"; then
      [ "$(path_inode "$OWNER_LOCK" 2>/dev/null || true)" = "$observed_inode" ] || { emit_event "owner_race_rejected"; exit 0; }
      # An incomplete claim has no token/start identity to verify. Leave it in
      # place after bounded contention rather than risk quarantining a live
      # initializer from an older protocol.
      emit_event "owner_contention_exhausted"
      exit 0
    fi
    [ "$OBSERVED_OWNER_INODE" = "$observed_inode" ] || { emit_event "owner_race_rejected"; exit 0; }
    if kill -0 "$OBSERVED_OWNER_PID" 2>/dev/null; then
      observed_start=$(process_start_identity "$OBSERVED_OWNER_PID" 2>/dev/null || true)
      if [ -n "$observed_start" ] && [ "$observed_start" = "$OBSERVED_OWNER_START_IDENTITY" ]; then
        emit_event "live_owner_rejected"
        exit 0
      fi
    fi
    [ "$(path_inode "$OWNER_LOCK" 2>/dev/null || true)" = "$observed_inode" ] || { emit_event "owner_race_rejected"; exit 0; }
    quarantine_observed_owner "$observed_inode" || { emit_event "owner_race_rejected"; exit 0; }
    attempt=$((attempt + 1))
  done
  emit_event "owner_contention_exhausted"
  exit 0
}

pause_fatal() {
  local reason=$1
  write_status "paused_fatal" "$reason" 0 || true
  emit_event "$reason"
  exit 0
}

validate_runtime_config_trust() {
  if ! absolute_path "$CONFIG_PATH" || ! path_is_trusted_ancestry "$CONFIG_PATH" || [ ! -f "$CONFIG_PATH" ] || [ ! -r "$CONFIG_PATH" ] || [ -L "$CONFIG_PATH" ]; then
    pause_fatal "config_unreadable"
  fi
  if [ "$(file_owner_uid "$CONFIG_PATH")" != "$CURRENT_UID" ] || [ "$(file_mode "$CONFIG_PATH")" != "600" ]; then
    pause_fatal "config_permissions"
  fi
}

validate_ssh_input_trust() {
  local identity_mode ssh_config_mode
  absolute_path "$SSH_CONFIG_FILE" || pause_fatal "config_invalid_path"
  absolute_path "$SSH_IDENTITY_FILE" || pause_fatal "config_invalid_path"
  path_is_trusted_ancestry "$SSH_CONFIG_FILE" || pause_fatal "ssh_config_untrusted_path"
  path_is_trusted_ancestry "$SSH_IDENTITY_FILE" || pause_fatal "identity_untrusted_path"
  [ -f "$SSH_CONFIG_FILE" ] && [ -r "$SSH_CONFIG_FILE" ] && [ ! -L "$SSH_CONFIG_FILE" ] || pause_fatal "ssh_config_unreadable"
  [ -f "$SSH_IDENTITY_FILE" ] && [ -r "$SSH_IDENTITY_FILE" ] && [ ! -L "$SSH_IDENTITY_FILE" ] || pause_fatal "identity_unreadable"
  [ "$(file_owner_uid "$SSH_CONFIG_FILE")" = "$CURRENT_UID" ] || pause_fatal "ssh_config_owner"
  ssh_config_mode=$(file_mode "$SSH_CONFIG_FILE")
  [ "$ssh_config_mode" = "600" ] || pause_fatal "ssh_config_permissions"
  [ "$(file_owner_uid "$SSH_IDENTITY_FILE")" = "$CURRENT_UID" ] || pause_fatal "identity_owner"
  identity_mode=$(file_mode "$SSH_IDENTITY_FILE")
  case "$identity_mode" in 400|600) ;; *) pause_fatal "identity_permissions" ;; esac
}

parse_config() {
  local seen raw_line line key value
  validate_runtime_config_trust

  CONFIG_FINGERPRINT=$(file_fingerprint "$CONFIG_PATH")
  [ -n "$CONFIG_FINGERPRINT" ] || CONFIG_FINGERPRINT="unavailable"
  seen="|"
  while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    line=${raw_line%$'\r'}
    case "$line" in
      ""|'#'*) continue ;;
    esac
    case "$line" in
      *=*) key=${line%%=*}; value=${line#*=} ;;
      *) pause_fatal "config_syntax" ;;
    esac
    case "$seen" in *"|$key|"*) pause_fatal "config_duplicate_key" ;; esac
    seen="${seen}${key}|"
    case "$key" in
      SSH_HOST) SSH_HOST=$value ;;
      SSH_CONFIG_FILE) SSH_CONFIG_FILE=$value ;;
      SSH_IDENTITY_FILE) SSH_IDENTITY_FILE=$value ;;
      REMOTE_BIND_HOST) REMOTE_BIND_HOST=$value ;;
      REMOTE_PORT) REMOTE_PORT=$value ;;
      LOCAL_HOST) LOCAL_HOST=$value ;;
      LOCAL_PORT) LOCAL_PORT=$value ;;
      HEALTHCHECK_URL) HEALTHCHECK_URL=$value ;;
      *) pause_fatal "config_unknown_key" ;;
    esac
  done < "$CONFIG_PATH"

  is_safe_endpoint "$SSH_HOST" || pause_fatal "config_invalid_host"
  is_safe_endpoint "$REMOTE_BIND_HOST" || pause_fatal "config_invalid_endpoint"
  is_safe_endpoint "$LOCAL_HOST" || pause_fatal "config_invalid_endpoint"
  is_positive_integer "$REMOTE_PORT" || pause_fatal "config_invalid_port"
  is_positive_integer "$LOCAL_PORT" || pause_fatal "config_invalid_port"
  [ "$REMOTE_PORT" -le 65535 ] || pause_fatal "config_invalid_port"
  [ "$LOCAL_PORT" -le 65535 ] || pause_fatal "config_invalid_port"
  case "$HEALTHCHECK_URL" in http://*|https://*) ;; *) pause_fatal "config_invalid_healthcheck" ;; esac
  case "$HEALTHCHECK_URL" in *[[:space:]]*) pause_fatal "config_invalid_healthcheck" ;; esac
  validate_ssh_input_trust
}

capture_trusted_input_contract() {
  CONFIG_INODE=$(path_inode "$CONFIG_PATH" 2>/dev/null || true)
  SSH_CONFIG_INODE=$(path_inode "$SSH_CONFIG_FILE" 2>/dev/null || true)
  SSH_IDENTITY_INODE=$(path_inode "$SSH_IDENTITY_FILE" 2>/dev/null || true)
  SSH_CONFIG_FINGERPRINT=$(file_fingerprint "$SSH_CONFIG_FILE")
  SSH_IDENTITY_FINGERPRINT=$(file_fingerprint "$SSH_IDENTITY_FILE")
  is_unsigned_integer "$CONFIG_INODE" && is_unsigned_integer "$SSH_CONFIG_INODE" &&
    is_unsigned_integer "$SSH_IDENTITY_INODE" && [ ${#CONFIG_FINGERPRINT} -eq 64 ] &&
    [ ${#SSH_CONFIG_FINGERPRINT} -eq 64 ] && [ ${#SSH_IDENTITY_FINGERPRINT} -eq 64 ] ||
    pause_fatal "trusted_input_snapshot_failed"
}

verify_trusted_input_contract() {
  validate_runtime_config_trust
  validate_ssh_input_trust
  [ "$(path_inode "$CONFIG_PATH" 2>/dev/null || true)" = "$CONFIG_INODE" ] &&
    [ "$(file_fingerprint "$CONFIG_PATH")" = "$CONFIG_FINGERPRINT" ] || pause_fatal "runtime_config_changed"
  [ "$(path_inode "$SSH_CONFIG_FILE" 2>/dev/null || true)" = "$SSH_CONFIG_INODE" ] &&
    [ "$(file_fingerprint "$SSH_CONFIG_FILE")" = "$SSH_CONFIG_FINGERPRINT" ] || pause_fatal "ssh_config_changed"
  [ "$(path_inode "$SSH_IDENTITY_FILE" 2>/dev/null || true)" = "$SSH_IDENTITY_INODE" ] &&
    [ "$(file_fingerprint "$SSH_IDENTITY_FILE")" = "$SSH_IDENTITY_FINGERPRINT" ] || pause_fatal "identity_changed"
}

build_ssh_arguments() {
  SSH_ARGUMENTS=(
    -F "$SSH_CONFIG_FILE"
    -i "$SSH_IDENTITY_FILE"
    -N
    -o BatchMode=yes
    -o ConnectTimeout=10
    -o ServerAliveInterval=10
    -o ServerAliveCountMax=3
    -o ExitOnForwardFailure=yes
    -o TCPKeepAlive=no
    -o ControlMaster=no
    -o ClearAllForwardings=no
    -o IdentitiesOnly=yes
    -o IdentityAgent=none
    -o AddKeysToAgent=no
    -o StrictHostKeyChecking=yes
    -R "${REMOTE_BIND_HOST}:${REMOTE_PORT}:${LOCAL_HOST}:${LOCAL_PORT}"
    "$SSH_HOST"
  )
}

validate_effective_ssh_forwarding() {
  local effective line key value expected_remote remote_count clear_value
  build_ssh_arguments
  effective=$("$SSH_BIN" -G "${SSH_ARGUMENTS[@]}" 2>/dev/null) || pause_fatal "ssh_effective_config"
  expected_remote="[${REMOTE_BIND_HOST}]:${REMOTE_PORT} [${LOCAL_HOST}]:${LOCAL_PORT}"
  remote_count=0
  clear_value=""
  while IFS= read -r line || [ -n "$line" ]; do
    key=${line%%[[:space:]]*}
    value=${line#"$key"}
    value=${value#"${value%%[![:space:]]*}"}
    case "$key" in
      remoteforward)
        remote_count=$((remote_count + 1))
        [ "$value" = "$expected_remote" ] || pause_fatal "ssh_forward_contract"
        ;;
      localforward|dynamicforward) pause_fatal "ssh_forward_contract" ;;
      clearallforwardings) clear_value=$value ;;
    esac
  done <<< "$effective"
  [ "$remote_count" -eq 1 ] && [ "$clear_value" = "no" ] || pause_fatal "ssh_forward_contract"
}

validate_child_launch_contract() {
  validate_event_sink_trust || pause_fatal "event_sink_untrusted"
  verify_trusted_input_contract
  validate_effective_ssh_forwarding
  # Recheck inode/content identities after ssh -G so replacement during the
  # render cannot silently become the input consumed by the child.
  verify_trusted_input_contract
}

atomic_replace_history() {
  local history_file cutoff append_value temporary value
  history_file=$1
  cutoff=$2
  append_value=$3
  temporary="$STATE_DIR/.history.$$.${RANDOM}"
  : > "$temporary" || return 1
  chmod 600 "$temporary" || return 1
  if [ -f "$history_file" ]; then
    while IFS= read -r value; do
      if is_unsigned_integer "$value" && [ "$value" -ge "$cutoff" ]; then
        printf '%s\n' "$value" >> "$temporary"
      fi
    done < "$history_file"
  fi
  if [ -n "$append_value" ]; then printf '%s\n' "$append_value" >> "$temporary"; fi
  mv -f "$temporary" "$history_file"
}

history_count() {
  if [ -f "$1" ]; then awk 'NF { count += 1 } END { print count + 0 }' "$1"; else printf '0\n'; fi
}

sleep_with_status() {
  local duration=$1
  COOLDOWN_COMPLETED=0
  write_status "cooldown" "restart_storm" "$duration" || return 70
  emit_event "restart_storm_cooldown"
  sleep "$duration"
  rm -f "$COOLDOWN_FILE" "$WRAPPER_HISTORY_FILE" "$CHILD_HISTORY_FILE"
  ATTEMPT=0
  COOLDOWN_COMPLETED=1
}

wait_for_test_backoff_gate() {
  local tick
  if [ "$TESTING" != "1" ] || [ -z "$TEST_BACKOFF_READY_FILE" ] || [ -z "$TEST_BACKOFF_RELEASE_FILE" ]; then
    return 0
  fi
  printf '%s\n' "$ATTEMPT" > "$TEST_BACKOFF_READY_FILE" || return 70
  chmod 600 "$TEST_BACKOFF_READY_FILE" 2>/dev/null || true
  tick=0
  while [ ! -e "$TEST_BACKOFF_RELEASE_FILE" ] && [ "$tick" -lt "$TEST_BACKOFF_GATE_TICKS" ]; do
    sleep "$TEST_BACKOFF_GATE_TICK_SECONDS"
    tick=$((tick + 1))
  done
  [ -e "$TEST_BACKOFF_RELEASE_FILE" ] || return 70
  rm -f "$TEST_BACKOFF_RELEASE_FILE"
}

honor_persisted_cooldown() {
  local now until
  now=$(date +%s)
  if [ -f "$COOLDOWN_FILE" ]; then
    until=$(cat "$COOLDOWN_FILE" 2>/dev/null || true)
    if is_unsigned_integer "$until" && [ "$until" -gt "$now" ]; then
      sleep_with_status $((until - now))
    else
      rm -f "$COOLDOWN_FILE"
    fi
  fi
}

record_wrapper_start() {
  local now cutoff cooldown_until
  now=$(date +%s)
  cutoff=$((now - QUICK_START_WINDOW_SECONDS))
  atomic_replace_history "$WRAPPER_HISTORY_FILE" "$cutoff" "$now" || exit 70
  if [ "$(history_count "$WRAPPER_HISTORY_FILE")" -ge "$QUICK_START_LIMIT" ]; then
    cooldown_until=$((now + COOLDOWN_SECONDS))
    atomic_write_lines "$COOLDOWN_FILE" "$cooldown_until" || exit 70
    sleep_with_status "$COOLDOWN_SECONDS"
  fi
}

record_child_start() {
  local now cutoff
  now=$(date +%s)
  cutoff=$((now - QUICK_START_WINDOW_SECONDS))
  atomic_replace_history "$CHILD_HISTORY_FILE" "$cutoff" "$now" || return 70
}

maybe_cooldown_after_exit() {
  local now cutoff cooldown_until
  now=$(date +%s)
  cutoff=$((now - QUICK_START_WINDOW_SECONDS))
  atomic_replace_history "$CHILD_HISTORY_FILE" "$cutoff" "" || return 70
  if [ "$(history_count "$CHILD_HISTORY_FILE")" -ge "$QUICK_START_LIMIT" ]; then
    cooldown_until=$((now + COOLDOWN_SECONDS))
    atomic_write_lines "$COOLDOWN_FILE" "$cooldown_until" || return 70
    sleep_with_status "$COOLDOWN_SECONDS"
  fi
}

classify_exit() {
  local code=$1
  if [ "$code" -eq 0 ]; then
    printf 'exit_0'
  elif [ "$code" -eq 255 ]; then
    printf 'exit_255'
  elif [ "$code" -gt 128 ]; then
    printf 'signal_%s' "$((code - 128))"
  else
    printf 'exit_other'
  fi
}

backoff_for_attempt() {
  local index last_index
  index=$((ATTEMPT - 1))
  last_index=$((${#BACKOFF_SECONDS[@]} - 1))
  if [ "$index" -gt "$last_index" ]; then index=$last_index; fi
  printf '%s' "${BACKOFF_SECONDS[$index]}"
}

sample_health() {
  local result code duration health_number
  if [ "$TESTING" = "1" ] && [ -n "$TEST_HEALTH_RESULT" ]; then
    result=$TEST_HEALTH_RESULT
  else
    result=$("$CURL_BIN" -fsS --max-time 3 -o /dev/null -w '%{http_code} %{time_total}' "$HEALTHCHECK_URL" 2>/dev/null || true)
  fi
  code=${result%% *}
  duration=${result#* }
  if ! is_unsigned_integer "$code" || [ ${#code} -ne 3 ]; then code=000; fi
  health_number=$((10#$code))
  if [ -z "$duration" ] || [ "$duration" = "$result" ]; then duration=0; fi
  HEALTH_CODE=$health_number
  HEALTH_DURATION_MS=$("$AWK_BIN" -v seconds="$duration" 'BEGIN { if (seconds !~ /^[0-9]+([.][0-9]+)?$/) seconds=0; printf "%d", seconds * 1000 }')
  write_status "running" "none" 0 || return 70
  emit_event "health_sample"
}

spawn_child() {
  local handshake child_executable tick actual_pgid
  verify_current_owner && verify_current_process_identity || return 70
  validate_child_launch_contract
  handshake="$STATE_DIR/.child-pgid.${OWNER_TOKEN}.${ATTEMPT}"
  CHILD_HANDSHAKE_FILE=$handshake
  rm -f "$handshake"

  child_executable=$SSH_BIN
  if [ "$TESTING" = "1" ] && [ -n "$TEST_CHILD" ]; then
    child_executable=$TEST_CHILD
  fi

  if [ "$TESTING" = "1" ] && [ "$TEST_HANDSHAKE_FAIL" = "1" ]; then
    "$ENV_BIN" -i HOME="$HOME" PATH="/usr/bin:/bin:/usr/sbin:/sbin" USER="$RUNTIME_USER" LOGNAME="$RUNTIME_LOGNAME" TAKODE_RELAY_SUPERVISOR_TEST_STATE="$TEST_STATE" \
      "$PERL_BIN" -e 'setpgrp(0,0) or die "setpgrp failed: $!"; sleep 30' >/dev/null 2>&1 &
  elif [ "$TESTING" = "1" ]; then
    "$ENV_BIN" -i HOME="$HOME" PATH="/usr/bin:/bin:/usr/sbin:/sbin" USER="$RUNTIME_USER" LOGNAME="$RUNTIME_LOGNAME" TAKODE_RELAY_SUPERVISOR_TEST_STATE="$TEST_STATE" \
      "$PERL_BIN" -e 'my $file=shift @ARGV; setpgrp(0,0) or die "setpgrp failed: $!"; open(my $fh, ">", $file) or die $!; chmod 0600, $file; print $fh "$$\n"; close($fh); exec @ARGV' \
      "$handshake" "$child_executable" "${SSH_ARGUMENTS[@]}" >/dev/null 2>&1 &
  else
    "$ENV_BIN" -i HOME="$HOME" PATH="/usr/bin:/bin:/usr/sbin:/sbin" USER="$RUNTIME_USER" LOGNAME="$RUNTIME_LOGNAME" \
      "$PERL_BIN" -e 'my $file=shift @ARGV; setpgrp(0,0) or die "setpgrp failed: $!"; open(my $fh, ">", $file) or die $!; chmod 0600, $file; print $fh "$$\n"; close($fh); exec @ARGV' \
      "$handshake" "$child_executable" "${SSH_ARGUMENTS[@]}" >/dev/null 2>&1 &
  fi
  CHILD_PID=$!

  tick=0
  while [ ! -s "$handshake" ] && kill -0 "$CHILD_PID" 2>/dev/null && [ "$tick" -lt "$HANDSHAKE_WAIT_TICKS" ]; do
    sleep "$HANDSHAKE_TICK_SECONDS"
    tick=$((tick + 1))
  done

  if [ ! -s "$handshake" ]; then
    terminate_child
    rm -f "$handshake"
    CHILD_HANDSHAKE_FILE=""
    write_status "crashed" "pgid_handshake_failed" 0 || true
    emit_event "pgid_handshake_failed"
    return 70
  fi

  CHILD_PGID=$(cat "$handshake" 2>/dev/null || true)
  rm -f "$handshake"
  CHILD_HANDSHAKE_FILE=""
  if ! is_unsigned_integer "$CHILD_PGID" || [ "$CHILD_PGID" != "$CHILD_PID" ]; then
    terminate_child
    write_status "crashed" "pgid_identity_failed" 0 || true
    emit_event "pgid_identity_failed"
    return 70
  fi
  if kill -0 "$CHILD_PID" 2>/dev/null; then
    actual_pgid=$(ps -o pgid= -p "$CHILD_PID" 2>/dev/null | tr -d '[:space:]')
    if [ -z "$actual_pgid" ] && ! kill -0 "$CHILD_PID" 2>/dev/null; then
      : # The verified child exited between the liveness and ps probes.
    elif [ "$actual_pgid" != "$CHILD_PGID" ]; then
      terminate_child
      write_status "crashed" "pgid_identity_failed" 0 || true
      emit_event "pgid_identity_failed"
      return 70
    fi
  fi

  CHILD_STARTED_AT=$(date +%s)
  record_child_start || return 70
  write_status "running" "none" 0 || return 70
  emit_event "child_started"
  sample_health || return 70
  return 0
}

run_loop() {
  local child_status child_finished_at child_uptime stable_reset exit_class backoff
  while [ "$STOPPING" -eq 0 ]; do
    honor_persisted_cooldown
    ATTEMPT=$((ATTEMPT + 1))
    if ! spawn_child; then return 70; fi

    wait "$CHILD_PID"
    child_status=$?
    child_finished_at=$(date +%s)
    child_uptime=$((child_finished_at - CHILD_STARTED_AT))
    CHILD_PID=""
    CHILD_PGID=""
    if [ "$STOPPING" -eq 1 ]; then return 0; fi

    CHILD_EXIT_COUNT=$((CHILD_EXIT_COUNT + 1))
    exit_class=$(classify_exit "$child_status")
    stable_reset=0
    if [ "$child_uptime" -ge "$STABLE_RESET_SECONDS" ]; then
      ATTEMPT=1
      rm -f "$CHILD_HISTORY_FILE"
      emit_event "stable_child_reset"
      stable_reset=1
    fi

    backoff=$(backoff_for_attempt)
    write_status "backoff" "$exit_class" "$backoff" || return 70
    emit_event "unexpected_child_exit"
    COOLDOWN_COMPLETED=0
    maybe_cooldown_after_exit || return 70

    if [ "$TESTING" = "1" ] && is_positive_integer "$TEST_MAX_CHILD_EXITS" && [ "$CHILD_EXIT_COUNT" -ge "$TEST_MAX_CHILD_EXITS" ]; then
      write_status "paused_test_complete" "$exit_class" 0 || true
      exit 0
    fi
    if [ "$COOLDOWN_COMPLETED" -eq 0 ]; then
      wait_for_test_backoff_gate || return 70
      sleep "$backoff"
      if [ "$stable_reset" -eq 1 ]; then ATTEMPT=0; fi
    fi
  done
}

initialize_state_dir
acquire_owner
initialize_event_sink || pause_fatal "event_sink_untrusted"
validate_runtime_environment
parse_config
capture_trusted_input_contract
honor_persisted_cooldown
record_wrapper_start
write_status "starting" "none" 0 || exit 70
emit_event "wrapper_started"
run_loop
exit $?
