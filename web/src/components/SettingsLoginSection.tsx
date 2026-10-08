import { useEffect, useState } from "react";
import {
  fetchLoginStatus,
  logOut,
  setLoginPassword,
  signOutOtherDevices,
  turnOffLogin,
  type LoginStatus,
} from "../browser-login.js";
import { SettingsSubsection } from "./settings-controls.js";

const INPUT_CLASS =
  "min-w-0 flex-1 px-3 py-2 rounded-lg bg-cc-input-bg border border-cc-border text-sm text-cc-fg focus:outline-none focus:border-cc-primary/60";
const PRIMARY_BUTTON_CLASS =
  "px-3 py-2 rounded-lg text-sm font-medium bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer disabled:cursor-not-allowed disabled:bg-cc-hover disabled:text-cc-muted";
const SECONDARY_BUTTON_CLASS =
  "px-3 py-2 rounded-lg text-sm font-medium bg-cc-hover text-cc-fg hover:bg-cc-active cursor-pointer disabled:cursor-not-allowed disabled:text-cc-muted";

/**
 * Optional password that browsers must enter before using this server, for
 * servers reachable from other machines. Agent sessions keep their own tokens.
 */
export function SettingsLoginSection({ hidden = false }: { hidden?: boolean }) {
  const [status, setStatus] = useState<LoginStatus | null>(null);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetchLoginStatus()
      .then(setStatus)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setStatus(await fetchLoginStatus());
      setCurrent("");
      setPassword("");
      setConfirm("");
      setNotice(done);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <SettingsSubsection title="Login" hidden={hidden}>
        {error ? <p className="text-xs text-cc-error">{error}</p> : null}
      </SettingsSubsection>
    );
  }

  const mismatch = confirm.length > 0 && password !== confirm;
  const newPasswordReady = password.length >= status.minPasswordLength && password === confirm;

  return (
    <SettingsSubsection
      title="Login"
      description={
        status.enabled
          ? "On: browsers need the password. Agent sessions and hosts use their own tokens."
          : "Off: anyone who can reach this server can use it. Turn it on before making the server reachable from other machines."
      }
      hidden={hidden}
    >
      {status.enabled && (
        <input
          type="password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          placeholder="Current password"
          aria-label="Current password"
          autoComplete="current-password"
          className={`w-full ${INPUT_CLASS}`}
        />
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={`New password (${status.minPasswordLength}+ characters)`}
          aria-label="New password"
          autoComplete="new-password"
          className={INPUT_CLASS}
        />
        <input
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          placeholder="Repeat new password"
          aria-label="Repeat new password"
          autoComplete="new-password"
          className={INPUT_CLASS}
        />
      </div>
      {mismatch && <p className="text-xs text-cc-error">The passwords do not match.</p>}

      <div className="flex flex-wrap gap-2">
        {status.enabled ? (
          <>
            <button
              type="button"
              disabled={busy || !current || !newPasswordReady}
              onClick={() =>
                void run(() => setLoginPassword(password, current), "Password changed. Other devices were signed out.")
              }
              className={PRIMARY_BUTTON_CLASS}
            >
              Change password
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(signOutOtherDevices, "Other devices were signed out.")}
              className={SECONDARY_BUTTON_CLASS}
            >
              Sign out other devices
            </button>
            <button type="button" disabled={busy} onClick={() => void logOut()} className={SECONDARY_BUTTON_CLASS}>
              Log out
            </button>
            <button
              type="button"
              disabled={busy || !current}
              onClick={() => void run(() => turnOffLogin(current), "Login is off.")}
              className={SECONDARY_BUTTON_CLASS}
            >
              Turn off login
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy || !newPasswordReady}
            onClick={() => void run(() => setLoginPassword(password), "Login is on. Other browsers must now log in.")}
            className={PRIMARY_BUTTON_CLASS}
          >
            Turn on login
          </button>
        )}
      </div>

      {error && <p className="text-xs text-cc-error">{error}</p>}
      {notice && <p className="text-xs text-cc-success">{notice}</p>}
      {status.enabled && (
        <p className="text-xs text-cc-muted">
          Forgot the password? Stop the server, delete this server's file in ~/.companion/browser-login, and start it
          again. Login is then off.
        </p>
      )}
    </SettingsSubsection>
  );
}
