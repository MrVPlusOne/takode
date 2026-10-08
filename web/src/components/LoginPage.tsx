import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { logIn, useLoginGate } from "../browser-login.js";
import { getInitialDarkMode } from "../store-initial.js";

/**
 * Shows the app only once the server says this browser may use it. Servers
 * without a login password show the app straight away.
 */
export function LoginGate({ children }: { children: ReactNode }) {
  const state = useLoginGate();
  if (state === "checking") return null;
  if (state === "login") return <LoginPage />;
  return <>{children}</>;
}

export function LoginPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The app applies the saved theme once it mounts; the login screen runs before it.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", getInitialDarkMode());
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await logIn(password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-cc-bg px-6 font-sans-ui text-cc-fg antialiased">
      <form onSubmit={onSubmit} className="w-full max-w-xs space-y-4" aria-label="Log in to Takode">
        <div className="flex flex-col items-center gap-3">
          <img src="/app-logo.png" alt="" className="h-12 w-12" />
          <h1 className="text-lg font-semibold">Takode</h1>
        </div>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          aria-label="Password"
          autoComplete="current-password"
          autoFocus
          className="w-full px-3 py-2 rounded-lg bg-cc-input-bg border border-cc-border text-sm text-cc-fg focus:outline-none focus:border-cc-primary/60"
        />
        {error && (
          <p role="alert" className="text-xs text-cc-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full px-3 py-2 rounded-lg text-sm font-medium bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer disabled:cursor-not-allowed disabled:bg-cc-hover disabled:text-cc-muted"
        >
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
