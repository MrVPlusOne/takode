import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { BrowserLogin, LOGIN_REQUIRED_HEADER, loginGate } from "./browser-login.js";
import { createBrowserLoginRoutes } from "./routes/browser-login.js";
import { hasValidSessionToken } from "./routes/auth.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const ORIGIN = "http://takode.test";

describe("BrowserLogin", () => {
  let dir: string;
  let path: string;
  let now: number;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "browser-login-"));
    path = join(dir, "login.json");
    now = Date.UTC(2026, 9, 7);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const open = () => BrowserLogin.open({ path, serverId: "server-1", now: () => now });

  /** A request carrying the cookie from a Set-Cookie header, as a browser would send it. */
  function withCookie(setCookie: string, url = `${ORIGIN}/api/sessions`): Request {
    return new Request(url, { headers: { cookie: `other=1; ${setCookie.split(";")[0]}` } });
  }

  function gate(login: BrowserLogin, request: Request, hasSessionToken = false) {
    return loginGate(request, { login, hasSessionToken: () => hasSessionToken, selfAuthenticatedPaths: ["/ws/host"] });
  }

  async function enabledLogin(password = "correct horse") {
    const login = await open();
    const result = await login.setPassword(password, undefined, new Request(`${ORIGIN}/api/auth/password`));
    if ("error" in result) throw new Error(result.error);
    return { login, cookie: result.setCookie };
  }

  // Without a password nothing changes: every request passes, as before login existed.
  it("is off until a password is set", async () => {
    const login = await open();
    expect(login.enabled).toBe(false);
    expect(gate(login, new Request(`${ORIGIN}/api/sessions`))).toBeNull();
    expect(gate(login, new Request(`${ORIGIN}/ws/browser/abc`))).toBeNull();
  });

  // The password is stored only as a salted hash in a private file, and a
  // restarted server (a fresh instance) still accepts the password and the
  // cookies it issued before.
  it("stores a private hash and survives a restart", async () => {
    const { cookie } = await enabledLogin();
    const stored = await readFile(path, "utf-8");
    expect(stored).not.toContain("correct horse");
    expect(stored).toContain("scrypt$");
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    const reloaded = await open();
    expect(reloaded.enabled).toBe(true);
    expect(reloaded.isLoggedIn(withCookie(cookie))).toBe(true);
    expect(await reloaded.login("wrong password", new Request(ORIGIN))).toEqual({
      status: 401,
      error: "Wrong password",
    });
    expect(await reloaded.login("correct horse", new Request(ORIGIN))).toHaveProperty("setCookie");
  });

  // Protected: the API, WebSockets and the HTML file preview. Open: the static
  // frontend, login itself, health/readiness probes, self-authenticating
  // routes, and agent CLIs with a valid session token.
  it("guards the application surface and lets credentialed or public requests through", async () => {
    const { login, cookie } = await enabledLogin();

    for (const url of ["/api/sessions", "/ws/browser/abc", "/ws/terminal/abc", "/file-preview/open?path=x", "/api"]) {
      const response = gate(login, new Request(`${ORIGIN}${url}`));
      expect(response?.status).toBe(401);
      expect(response?.headers.get(LOGIN_REQUIRED_HEADER)).toBe("1");
    }
    for (const url of [
      "/",
      "/index.html",
      "/assets/app.js",
      "/manifest.json",
      "/api/auth/status",
      "/api/auth/login",
      "/api/health",
      "/api/ready",
      "/api/integrations/codex/bind",
      "/ws/host",
    ]) {
      expect(gate(login, new Request(`${ORIGIN}${url}`))).toBeNull();
    }
    expect(gate(login, withCookie(cookie))).toBeNull();
    expect(gate(login, withCookie(cookie, `${ORIGIN}/ws/browser/abc`))).toBeNull();
    expect(gate(login, new Request(`${ORIGIN}/api/sessions`), true)).toBeNull();
    expect(
      gate(login, new Request(`${ORIGIN}/api/sessions`, { headers: { cookie: "takode_login_server1=x.y" } })),
    ).not.toBeNull();
  });

  // Encoded characters and dot segments must not turn a protected route into a
  // public-looking path, in either direction of decoding.
  it("does not let encoded paths slip past the gate", async () => {
    const { login } = await enabledLogin();
    for (const url of [
      "/%61pi/sessions",
      "/assets/..%2Fapi/sessions",
      "/api/sessions/..%2F..%2Fhealth",
      "/api/health%2F..%2Fsessions",
      "/API/sessions",
      "/assets/%E0%A4%A",
    ]) {
      expect(gate(login, new Request(`${ORIGIN}${url}`))?.status, url).toBe(401);
    }
  });

  // Cookies last 30 days. The app's status check renews them after a day, so
  // a device in regular use stays signed in.
  it("expires cookies after 30 days and renews them after a day", async () => {
    const { login, cookie } = await enabledLogin();
    expect(login.renewCookie(withCookie(cookie))).toBeNull();

    now += 2 * DAY_MS;
    const renewed = login.renewCookie(withCookie(cookie));
    expect(renewed).toContain("Max-Age=2592000");

    now += 29 * DAY_MS;
    expect(login.isLoggedIn(withCookie(cookie))).toBe(false);
    expect(login.isLoggedIn(withCookie(renewed!))).toBe(true);
  });

  // Changing the password and "sign out other devices" both revoke every
  // existing cookie while keeping the caller signed in. Changing or turning off
  // login requires the current password.
  it("revokes cookies on password change and sign-out, and checks the current password", async () => {
    const { login, cookie } = await enabledLogin();
    const request = new Request(`${ORIGIN}/api/auth/password`);

    expect(await login.setPassword("new password!", "wrong current", request)).toEqual({
      status: 401,
      error: "Current password is wrong",
    });
    expect(await login.setPassword("short", "correct horse", request)).toEqual({
      status: 400,
      error: "Use at least 8 characters",
    });
    const changed = await login.setPassword("new password!", "correct horse", request);
    if ("error" in changed) throw new Error(changed.error);
    expect(login.isLoggedIn(withCookie(cookie))).toBe(false);
    expect(login.isLoggedIn(withCookie(changed.setCookie))).toBe(true);

    const kept = await login.signOutOtherDevices(request);
    expect(login.isLoggedIn(withCookie(changed.setCookie))).toBe(false);
    expect(login.isLoggedIn(withCookie(kept!))).toBe(true);

    expect(await login.disable("correct horse")).toEqual({ status: 401, error: "Current password is wrong" });
    expect(await login.disable("new password!")).toBeNull();
    expect(login.enabled).toBe(false);
    await expect(readFile(path, "utf-8")).rejects.toThrow();
  });

  // Ten wrong passwords within 15 minutes lock login (even with the right
  // password) until older failures age out of the window.
  it("throttles repeated failures", async () => {
    const { login } = await enabledLogin();
    for (let attempt = 0; attempt < 10; attempt++) {
      expect(await login.login(`wrong-${attempt}`, new Request(ORIGIN))).toHaveProperty("status", 401);
    }
    expect(await login.login("correct horse", new Request(ORIGIN))).toHaveProperty("status", 429);
    now += 16 * 60 * 1000;
    expect(await login.login("correct horse", new Request(ORIGIN))).toHaveProperty("setCookie");
  });

  // Guesses sent in parallel are counted before their hash checks finish, so
  // they cannot all slip under the limit together.
  it("throttles parallel guesses", async () => {
    const { login } = await enabledLogin();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, attempt) => login.login(`wrong-${attempt}`, new Request(ORIGIN))),
    );
    expect(results.filter((result) => "status" in result && result.status === 429)).toHaveLength(10);
  });

  // Over HTTPS, directly or behind a TLS-terminating proxy, the cookie is
  // marked Secure; over plain http (for example localhost) it cannot be.
  it("marks the cookie Secure over https", async () => {
    const { login, cookie } = await enabledLogin();
    expect(cookie).toContain("HttpOnly; SameSite=Lax");
    expect(cookie).not.toContain("Secure");
    const https = await login.login("correct horse", new Request("https://takode.test/api/auth/login"));
    expect(https).toHaveProperty("setCookie", expect.stringContaining("; Secure"));
    const proxied = await login.login(
      "correct horse",
      new Request(`${ORIGIN}/api/auth/login`, { headers: { "x-forwarded-proto": "https" } }),
    );
    expect(proxied).toHaveProperty("setCookie", expect.stringContaining("; Secure"));
  });

  // The HTTP routes the browser uses: status, login, logout and turning login
  // on from Settings.
  it("serves status, login, logout and password routes", async () => {
    const login = await open();
    const app = new Hono().route("/api", createBrowserLoginRoutes(login, { onLoginsRevoked: () => {} }));
    const call = (method: string, url: string, body?: object, cookie?: string) =>
      app.request(`${ORIGIN}${url}`, {
        method,
        headers: { "Content-Type": "application/json", ...(cookie ? { cookie: cookie.split(";")[0]! } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

    expect(await (await call("GET", "/api/auth/status")).json()).toEqual({
      enabled: false,
      loggedIn: false,
      minPasswordLength: 8,
    });
    const enabled = await call("PUT", "/api/auth/password", { password: "correct horse" });
    expect(enabled.status).toBe(200);
    const cookie = enabled.headers.get("set-cookie")!;

    expect(await (await call("GET", "/api/auth/status", undefined, cookie)).json()).toMatchObject({
      enabled: true,
      loggedIn: true,
    });
    const failed = await call("POST", "/api/auth/login", { password: "nope" });
    expect(failed.status).toBe(401);
    expect(await failed.json()).toEqual({ error: "Wrong password" });
    const loggedIn = await call("POST", "/api/auth/login", { password: "correct horse" });
    expect(loggedIn.headers.get("set-cookie")).toContain("takode_login_server1=");
    const loggedOut = await call("POST", "/api/auth/logout");
    expect(loggedOut.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  // Agent CLIs pass the gate with the session headers they already send; the
  // session may be named by number, and a wrong or missing token does not count.
  it("recognizes agent session tokens", () => {
    const launcher = {
      resolveSessionId: (raw: string) => (raw === "7" || raw === "session-7" ? "session-7" : null),
      verifySessionAuthToken: (id: string, token: string) => id === "session-7" && token === "token-7",
    };
    const request = (headers: Record<string, string>) => new Request(`${ORIGIN}/api/sessions`, { headers });
    const sessionHeaders = (id: string, token: string) => ({
      "x-companion-session-id": id,
      "x-companion-auth-token": token,
    });
    expect(hasValidSessionToken(request(sessionHeaders("7", "token-7")), launcher)).toBe(true);
    expect(hasValidSessionToken(request(sessionHeaders("session-7", "token-7")), launcher)).toBe(true);
    expect(hasValidSessionToken(request(sessionHeaders("7", "wrong")), launcher)).toBe(false);
    expect(hasValidSessionToken(request(sessionHeaders("8", "token-7")), launcher)).toBe(false);
    expect(hasValidSessionToken(request({ "x-companion-session-id": "7" }), launcher)).toBe(false);
  });
});
