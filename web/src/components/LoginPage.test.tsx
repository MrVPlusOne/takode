// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { checkLogin, installLoginRequiredWatcher, resetLoginGateForTest } from "../browser-login.js";
import { LoginGate } from "./LoginPage.js";
import { SettingsLoginSection } from "./SettingsLoginSection.js";

/**
 * A fake of the server's login routes with one password, so the components
 * talk to the same API shape and status codes as the real server.
 */
function serveLoginRoutes(initial: { enabled: boolean; loggedIn: boolean }) {
  let { enabled, loggedIn } = initial;
  let password = "correct horse";
  const requests: string[] = [];
  const json = (body: object, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};
      requests.push(`${method} ${url}`);
      if (url === "/api/auth/status") return json({ enabled, loggedIn, minPasswordLength: 8 });
      if (url === "/api/auth/login") {
        if (body.password !== password) return json({ error: "Wrong password" }, 401);
        loggedIn = true;
        return json({ ok: true });
      }
      if (url === "/api/auth/password" && method === "PUT") {
        if (enabled && body.currentPassword !== password) return json({ error: "Current password is wrong" }, 401);
        password = body.password!;
        enabled = true;
        loggedIn = true;
        return json({ ok: true });
      }
      if (url === "/api/auth/password" && method === "DELETE") {
        if (body.currentPassword !== password) return json({ error: "Current password is wrong" }, 401);
        enabled = false;
        return json({ ok: true });
      }
      if (url === "/api/auth/sign-out-others") return json({ ok: true });
      if (!enabled || loggedIn) return json({ sessions: [] });
      return json({ error: "Login required" }, 401, { "x-takode-login-required": "1" });
    }),
  );
  return {
    requests,
    signOut: () => {
      loggedIn = false;
    },
  };
}

describe("LoginGate", () => {
  beforeEach(() => resetLoginGateForTest());
  afterEach(() => vi.unstubAllGlobals());

  // A server without a password shows the app straight away.
  it("shows the app when login is off", async () => {
    serveLoginRoutes({ enabled: false, loggedIn: false });
    render(<LoginGate>app content</LoginGate>);
    await act(() => checkLogin());
    expect(screen.getByText("app content")).toBeTruthy();
  });

  // With login on, the app stays hidden until the right password is entered.
  it("asks for the password and shows the app after a successful login", async () => {
    serveLoginRoutes({ enabled: true, loggedIn: false });
    render(<LoginGate>app content</LoginGate>);
    await act(() => checkLogin());
    expect(screen.queryByText("app content")).toBeNull();

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong password" } });
    await act(async () => fireEvent.click(screen.getByText("Log in")));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Wrong password"));

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
    await act(async () => fireEvent.click(screen.getByText("Log in")));
    await waitFor(() => expect(screen.getByText("app content")).toBeTruthy());
  });

  // When a login expires or is revoked while the app is open, the next API call
  // that the server rejects with the login-required marker brings back the
  // login screen; other 401s do not.
  it("returns to the login screen when an API call reports the login is gone", async () => {
    const server = serveLoginRoutes({ enabled: true, loggedIn: true });
    installLoginRequiredWatcher();
    render(<LoginGate>app content</LoginGate>);
    await act(() => checkLogin());
    expect(screen.getByText("app content")).toBeTruthy();

    server.signOut();
    await act(async () => {
      await window.fetch("/api/sessions");
    });
    expect(screen.getByLabelText("Password")).toBeTruthy();
  });
});

describe("SettingsLoginSection", () => {
  beforeEach(() => resetLoginGateForTest());
  afterEach(() => vi.unstubAllGlobals());

  // Turning login on needs a long enough password typed twice the same way.
  it("turns login on with a confirmed password", async () => {
    const { requests } = serveLoginRoutes({ enabled: false, loggedIn: false });
    render(<SettingsLoginSection />);
    await waitFor(() => expect(screen.getByText("Turn on login")).toBeTruthy());
    const turnOn = screen.getByText("Turn on login") as HTMLButtonElement;

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a new password" } });
    fireEvent.change(screen.getByLabelText("Repeat new password"), { target: { value: "a new passw0rd" } });
    expect(screen.getByText("The passwords do not match.")).toBeTruthy();
    expect(turnOn.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Repeat new password"), { target: { value: "a new password" } });
    await act(async () => fireEvent.click(turnOn));
    await waitFor(() => expect(screen.getByText("Login is on. Other browsers must now log in.")).toBeTruthy());
    expect(requests).toContain("PUT /api/auth/password");
    expect(screen.getByText("Change password")).toBeTruthy();
  });

  // With login on, changing the password and turning login off both need the
  // current password; a wrong one shows the server's error.
  it("changes the password and turns login off with the current password", async () => {
    serveLoginRoutes({ enabled: true, loggedIn: true });
    render(<SettingsLoginSection />);
    await waitFor(() => expect(screen.getByText("Turn off login")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "not it" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "another password" } });
    fireEvent.change(screen.getByLabelText("Repeat new password"), { target: { value: "another password" } });
    await act(async () => fireEvent.click(screen.getByText("Change password")));
    await waitFor(() => expect(screen.getByText("Current password is wrong")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "correct horse" } });
    await act(async () => fireEvent.click(screen.getByText("Change password")));
    await waitFor(() => expect(screen.getByText("Password changed. Other devices were signed out.")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "another password" } });
    await act(async () => fireEvent.click(screen.getByText("Turn off login")));
    await waitFor(() => expect(screen.getByText("Turn on login")).toBeTruthy());
  });
});
