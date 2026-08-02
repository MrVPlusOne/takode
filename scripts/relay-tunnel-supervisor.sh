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

TESTING=${TAKODE_RELAY_SUPERVISOR_TESTING:-0}
TEST_CHILD=${TAKODE_RELAY_SUPERVISOR_TEST_CHILD:-}
TEST_STATE=${TAKODE_RELAY_SUPERVISOR_TEST_STATE:-}
TEST_LOG_FILE=${TAKODE_RELAY_SUPERVISOR_TEST_LOG_FILE:-}
TEST_MAX_CHILD_EXITS=${TAKODE_RELAY_SUPERVISOR_TEST_MAX_CHILD_EXITS:-0}
TEST_HANDSHAKE_FAIL=${TAKODE_RELAY_SUPERVISOR_TEST_HANDSHAKE_FAIL:-0}
TEST_HEALTH_RESULT=${TAKODE_RELAY_SUPERVISOR_TEST_HEALTH_RESULT:-}
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
fi

umask 077

OWNER_LOCK=""
OWNER_TOKEN=""
OWNER_ACQUIRED=0
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
HEALTH_CODE="null"
HEALTH_DURATION_MS="null"
COOLDOWN_COMPLETED=0

SSH_HOST=""
SSH_CONFIG_FILE=""
SSH_IDENTITY_FILE=""
REMOTE_BIND_HOST=""
REMOTE_PORT=""
LOCAL_HOST=""
LOCAL_PORT=""
HEALTHCHECK_URL=""

STATUS_FILE=""
WRAPPER_HISTORY_FILE=""
CHILD_HISTORY_FILE=""
COOLDOWN_FILE=""

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
  if stat -f '%Lp' "$1" >/dev/null 2>&1; then
    stat -f '%Lp' "$1"
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
  event_line="component=$COMPONENT schema=$SCHEMA_VERSION event=$event state=$CURRENT_STATE attempt=$ATTEMPT exit_class=$LAST_EXIT_CLASS backoff_seconds=$CURRENT_BACKOFF health_code=$HEALTH_CODE health_duration_ms=$HEALTH_DURATION_MS owner_token=$OWNER_TOKEN supervisor_pid=$$ child_pid=${CHILD_PID:-0} child_pgid=${CHILD_PGID:-0} config_fingerprint=$CONFIG_FINGERPRINT"
  if [ "$TESTING" = "1" ] && [ -n "$TEST_LOG_FILE" ]; then
    printf '%s\n' "$event_line" >> "$TEST_LOG_FILE"
    chmod 600 "$TEST_LOG_FILE"
  elif [ -x "$LOGGER_BIN" ]; then
    "$LOGGER_BIN" -t "$COMPONENT" -- "$event_line" >/dev/null 2>&1 || true
  fi
}

remove_owned_lock() {
  local recorded_token
  if [ "$OWNER_ACQUIRED" -ne 1 ] || [ ! -d "$OWNER_LOCK" ]; then
    return 0
  fi
  recorded_token=$(cat "$OWNER_LOCK/token" 2>/dev/null || true)
  if [ "$recorded_token" = "$OWNER_TOKEN" ]; then
    rm -rf "$OWNER_LOCK"
  fi
  OWNER_ACQUIRED=0
}

terminate_child() {
  local tick proposed_pgid actual_pgid
  if [ -z "$CHILD_PID" ]; then
    return 0
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
  if ! absolute_path "$STATE_DIR" || [ -L "$STATE_DIR" ]; then
    printf 'relay supervisor: state directory must be absolute\n' >&2
    exit 0
  fi
  mkdir -p "$STATE_DIR" || exit 70
  chmod 700 "$STATE_DIR" || exit 70
  STATUS_FILE="$STATE_DIR/status.json"
  WRAPPER_HISTORY_FILE="$STATE_DIR/wrapper-start-history"
  CHILD_HISTORY_FILE="$STATE_DIR/child-start-history"
  COOLDOWN_FILE="$STATE_DIR/cooldown-until"
  OWNER_LOCK="$STATE_DIR/owner.lock"
}

validate_runtime_environment() {
  if ! absolute_path "${HOME:-}" || [ -z "$RUNTIME_USER" ] || [ -z "$RUNTIME_LOGNAME" ]; then
    pause_fatal "environment_invalid"
  fi
  for required_binary in "$SSH_BIN" "$ENV_BIN" "$PERL_BIN" "$SHASUM_BIN" "$ID_BIN" "$CURL_BIN" "$AWK_BIN"; do
    if [ ! -x "$required_binary" ]; then pause_fatal "runtime_binary_missing"; fi
  done
}

acquire_owner() {
  local existing_pid quarantine
  OWNER_TOKEN=$(printf '%s' "$$:$PPID:$(date +%s):$RANDOM" | "$SHASUM_BIN" -a 256 | awk '{print $1}')
  if mkdir "$OWNER_LOCK" 2>/dev/null; then
    chmod 700 "$OWNER_LOCK"
  else
    existing_pid=$(cat "$OWNER_LOCK/pid" 2>/dev/null || true)
    if is_unsigned_integer "$existing_pid" && kill -0 "$existing_pid" 2>/dev/null; then
      emit_event "live_owner_rejected"
      exit 0
    fi
    quarantine="$STATE_DIR/owner.lock.quarantine.$(date +%s).${OWNER_TOKEN}"
    if ! mv "$OWNER_LOCK" "$quarantine" 2>/dev/null; then
      emit_event "owner_race_rejected"
      exit 0
    fi
    chmod 700 "$quarantine" 2>/dev/null || true
    chmod 600 "$quarantine/pid" "$quarantine/token" 2>/dev/null || true
    if ! mkdir "$OWNER_LOCK" 2>/dev/null; then
      emit_event "owner_race_rejected"
      exit 0
    fi
    chmod 700 "$OWNER_LOCK"
    emit_event "dead_owner_quarantined"
  fi
  atomic_write_lines "$OWNER_LOCK/pid" "$$" || exit 70
  atomic_write_lines "$OWNER_LOCK/token" "$OWNER_TOKEN" || exit 70
  OWNER_ACQUIRED=1
}

pause_fatal() {
  local reason=$1
  write_status "paused_fatal" "$reason" 0 || true
  emit_event "$reason"
  exit 0
}

parse_config() {
  local seen raw_line line key value identity_mode
  if ! absolute_path "$CONFIG_PATH" || [ ! -f "$CONFIG_PATH" ] || [ ! -r "$CONFIG_PATH" ] || [ -L "$CONFIG_PATH" ]; then
    pause_fatal "config_unreadable"
  fi
  if [ "$(file_owner_uid "$CONFIG_PATH")" != "$(id -u)" ] || [ "$(file_mode "$CONFIG_PATH")" != "600" ]; then
    pause_fatal "config_permissions"
  fi

  CONFIG_FINGERPRINT=$("$SHASUM_BIN" -a 256 "$CONFIG_PATH" 2>/dev/null | awk '{print $1}')
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
  absolute_path "$SSH_CONFIG_FILE" || pause_fatal "config_invalid_path"
  absolute_path "$SSH_IDENTITY_FILE" || pause_fatal "config_invalid_path"
  [ -f "$SSH_CONFIG_FILE" ] && [ -r "$SSH_CONFIG_FILE" ] && [ ! -L "$SSH_CONFIG_FILE" ] || pause_fatal "ssh_config_unreadable"
  [ -f "$SSH_IDENTITY_FILE" ] && [ -r "$SSH_IDENTITY_FILE" ] && [ ! -L "$SSH_IDENTITY_FILE" ] || pause_fatal "identity_unreadable"
  [ "$(file_owner_uid "$SSH_IDENTITY_FILE")" = "$(id -u)" ] || pause_fatal "identity_owner"
  identity_mode=$(file_mode "$SSH_IDENTITY_FILE")
  case "$identity_mode" in 400|600) ;; *) pause_fatal "identity_permissions" ;; esac
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
  local -a child_arguments
  handshake="$STATE_DIR/.child-pgid.${OWNER_TOKEN}.${ATTEMPT}"
  CHILD_HANDSHAKE_FILE=$handshake
  rm -f "$handshake"

  child_executable=$SSH_BIN
  child_arguments=(
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
    -o ClearAllForwardings=yes
    -o IdentitiesOnly=yes
    -o IdentityAgent=none
    -o AddKeysToAgent=no
    -o StrictHostKeyChecking=yes
    -R "${REMOTE_BIND_HOST}:${REMOTE_PORT}:${LOCAL_HOST}:${LOCAL_PORT}"
    "$SSH_HOST"
  )

  if [ "$TESTING" = "1" ] && [ -n "$TEST_CHILD" ]; then
    child_executable=$TEST_CHILD
  fi

  if [ "$TESTING" = "1" ] && [ "$TEST_HANDSHAKE_FAIL" = "1" ]; then
    "$ENV_BIN" -i HOME="$HOME" PATH="/usr/bin:/bin:/usr/sbin:/sbin" USER="$RUNTIME_USER" LOGNAME="$RUNTIME_LOGNAME" TAKODE_RELAY_SUPERVISOR_TEST_STATE="$TEST_STATE" \
      "$PERL_BIN" -e 'setpgrp(0,0) or die "setpgrp failed: $!"; sleep 30' >/dev/null 2>&1 &
  elif [ "$TESTING" = "1" ]; then
    "$ENV_BIN" -i HOME="$HOME" PATH="/usr/bin:/bin:/usr/sbin:/sbin" USER="${USER:-}" LOGNAME="${LOGNAME:-}" TAKODE_RELAY_SUPERVISOR_TEST_STATE="$TEST_STATE" \
      "$PERL_BIN" -e 'my $file=shift @ARGV; setpgrp(0,0) or die "setpgrp failed: $!"; open(my $fh, ">", $file) or die $!; chmod 0600, $file; print $fh "$$\n"; close($fh); exec @ARGV' \
      "$handshake" "$child_executable" "${child_arguments[@]}" >/dev/null 2>&1 &
  else
    "$ENV_BIN" -i HOME="$HOME" PATH="/usr/bin:/bin:/usr/sbin:/sbin" USER="$RUNTIME_USER" LOGNAME="$RUNTIME_LOGNAME" \
      "$PERL_BIN" -e 'my $file=shift @ARGV; setpgrp(0,0) or die "setpgrp failed: $!"; open(my $fh, ">", $file) or die $!; chmod 0600, $file; print $fh "$$\n"; close($fh); exec @ARGV' \
      "$handshake" "$child_executable" "${child_arguments[@]}" >/dev/null 2>&1 &
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
      sleep "$backoff"
      if [ "$stable_reset" -eq 1 ]; then ATTEMPT=0; fi
    fi
  done
}

initialize_state_dir
acquire_owner
validate_runtime_environment
parse_config
honor_persisted_cooldown
record_wrapper_start
write_status "starting" "none" 0 || exit 70
emit_event "wrapper_started"
run_loop
exit $?
