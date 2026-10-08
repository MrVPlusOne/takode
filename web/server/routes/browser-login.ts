import { Hono, type Context } from "hono";
import { MIN_PASSWORD_LENGTH, type BrowserLogin, type LoginFailure } from "../browser-login.js";

/**
 * Browser login: status, sign in and out, and the Settings controls that turn
 * login on, change the password, sign out other devices or turn login off.
 * Status, login and logout are reachable without a login (see `loginGate`).
 */
export function createBrowserLoginRoutes(
  login: BrowserLogin,
  options: {
    /** Close open browser connections, which stay authenticated otherwise, after other logins were revoked. */
    onLoginsRevoked: () => void;
  },
) {
  const api = new Hono();

  api.get("/auth/status", (c) => {
    const loggedIn = login.isLoggedIn(c.req.raw);
    const renewed = login.renewCookie(c.req.raw);
    if (renewed) c.header("Set-Cookie", renewed);
    c.header("Cache-Control", "no-store");
    return c.json({ enabled: login.enabled, loggedIn, minPasswordLength: MIN_PASSWORD_LENGTH });
  });

  api.post("/auth/login", async (c) => {
    const body = await readBody(c);
    return respond(c, await login.login(body.password ?? "", c.req.raw));
  });

  api.post("/auth/logout", (c) => {
    c.header("Set-Cookie", login.clearCookie(c.req.raw));
    return c.json({ ok: true });
  });

  api.put("/auth/password", async (c) => {
    const body = await readBody(c);
    const result = await login.setPassword(body.password ?? "", body.currentPassword, c.req.raw);
    if (!("error" in result)) options.onLoginsRevoked();
    return respond(c, result);
  });

  api.delete("/auth/password", async (c) => {
    const body = await readBody(c);
    const failure = await login.disable(body.currentPassword);
    if (failure) return c.json({ error: failure.error }, failure.status);
    c.header("Set-Cookie", login.clearCookie(c.req.raw));
    return c.json({ ok: true });
  });

  api.post("/auth/sign-out-others", async (c) => {
    const cookie = await login.signOutOtherDevices(c.req.raw);
    if (!cookie) return c.json({ error: "Login is not turned on" }, 400);
    options.onLoginsRevoked();
    c.header("Set-Cookie", cookie);
    return c.json({ ok: true });
  });

  return api;
}

async function readBody(c: Context): Promise<{ password?: string; currentPassword?: string }> {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ...(typeof body.password === "string" ? { password: body.password } : {}),
    ...(typeof body.currentPassword === "string" ? { currentPassword: body.currentPassword } : {}),
  };
}

function respond(c: Context, result: { setCookie: string } | LoginFailure): Response {
  if ("error" in result) return c.json({ error: result.error }, result.status);
  c.header("Set-Cookie", result.setCookie);
  return c.json({ ok: true });
}
