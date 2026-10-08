import { createHmac, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getPath } from "hono/utils/url";
import { decodeAndNormalizePathname } from "./opaque-origin-guard.js";

/** Header on 401 responses that tells the browser to show the login screen. */
export const LOGIN_REQUIRED_HEADER = "x-takode-login-required";

export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 1024;
const COOKIE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
/** A cookie older than this is reissued when the app checks its login status. */
const COOKIE_RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_WINDOW = 10;
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1 } as const;

interface StoredLogin {
  /** `scrypt$N$r$p$salt$hash`, base64url salt and hash. */
  passwordHash: string;
  /** Signs login cookies; replacing it signs every browser out. */
  cookieSecret: string;
}

export type LoginFailure = { status: 400 | 401 | 429; error: string };

/**
 * Optional owner-password login for browsers. While no password is set, the
 * server behaves as before. Once set, browsers must present a signed login
 * cookie; agent CLIs keep using their per-session tokens (see `loginGate`).
 *
 * The password hash and cookie secret live in their own 0600 file per server,
 * never in settings.json. Cookies are stateless (issue time plus HMAC), so
 * changing the password or signing out all devices just rotates the secret.
 * To recover a forgotten password, stop the server, delete the file and start it.
 */
export class BrowserLogin {
  private stored: StoredLogin | null = null;
  private failures: number[] = [];
  private pendingWrite: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    /** Includes the server ID because cookies are shared by every port on a host. */
    readonly cookieName: string,
    private readonly now: () => number,
  ) {}

  static async open(options: { path: string; serverId: string; now?: () => number }): Promise<BrowserLogin> {
    const login = new BrowserLogin(
      options.path,
      `takode_login_${options.serverId.replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}`,
      options.now ?? Date.now,
    );
    try {
      const parsed = JSON.parse(await readFile(options.path, "utf-8")) as Partial<StoredLogin>;
      if (typeof parsed.passwordHash === "string" && typeof parsed.cookieSecret === "string") {
        login.stored = { passwordHash: parsed.passwordHash, cookieSecret: parsed.cookieSecret };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return login;
  }

  static forServer(serverId: string): Promise<BrowserLogin> {
    return BrowserLogin.open({ path: join(homedir(), ".companion", "browser-login", `${serverId}.json`), serverId });
  }

  get enabled(): boolean {
    return this.stored !== null;
  }

  /** Whether the request carries a valid, unexpired login cookie. */
  isLoggedIn(request: Request): boolean {
    return this.cookieIssuedAt(request) !== null;
  }

  /** A fresh cookie when the request's cookie is valid but due for renewal. */
  renewCookie(request: Request): string | null {
    const issuedAt = this.cookieIssuedAt(request);
    if (issuedAt === null || this.now() - issuedAt < COOKIE_RENEW_AFTER_MS) return null;
    return this.issueCookie(request);
  }

  /** Check the password and return a login cookie. Failed attempts are throttled. */
  async login(password: string, request: Request): Promise<{ setCookie: string } | LoginFailure> {
    if (!this.stored) return { status: 400, error: "Login is not turned on" };
    const failure = await this.checkPassword(password, "Wrong password");
    return failure ?? { setCookie: this.issueCookie(request) };
  }

  /**
   * Turn login on or change the password. Changing it requires the current
   * password and signs out every other browser. Returns a cookie for the caller.
   */
  async setPassword(
    password: string,
    currentPassword: string | undefined,
    request: Request,
  ): Promise<{ setCookie: string } | LoginFailure> {
    const problem = passwordProblem(password);
    if (problem) return { status: 400, error: problem };
    const failure = await this.checkCurrentPassword(currentPassword);
    if (failure) return failure;
    await this.persist({ passwordHash: await hashPassword(password), cookieSecret: newSecret() });
    return { setCookie: this.issueCookie(request) };
  }

  /** Sign out every browser, keeping the caller signed in. */
  async signOutOtherDevices(request: Request): Promise<string | null> {
    if (!this.stored) return null;
    await this.persist({ ...this.stored, cookieSecret: newSecret() });
    return this.issueCookie(request);
  }

  /** Turn login off after checking the current password. */
  async disable(currentPassword: string | undefined): Promise<LoginFailure | null> {
    const failure = await this.checkCurrentPassword(currentPassword);
    if (failure) return failure;
    await this.persist(null);
    return null;
  }

  /** Set-Cookie value that removes the login cookie from this browser. */
  clearCookie(request: Request): string {
    return this.cookie("", 0, request);
  }

  private checkCurrentPassword(currentPassword: string | undefined): Promise<LoginFailure | null> {
    return this.stored ? this.checkPassword(currentPassword ?? "", "Current password is wrong") : Promise.resolve(null);
  }

  private async checkPassword(password: string, wrongMessage: string): Promise<LoginFailure | null> {
    const now = this.now();
    this.failures = this.failures.filter((at) => now - at < FAILURE_WINDOW_MS);
    if (this.failures.length >= MAX_FAILURES_PER_WINDOW) {
      return { status: 429, error: "Too many failed attempts. Try again in a few minutes." };
    }
    // Count the attempt before the slow hash check, so parallel guesses cannot
    // all pass the limit check first.
    this.failures.push(now);
    if (await verifyPassword(password, this.stored!.passwordHash)) {
      this.failures = [];
      return null;
    }
    return { status: 401, error: wrongMessage };
  }

  private cookieIssuedAt(request: Request): number | null {
    if (!this.stored) return null;
    const value = readCookie(request.headers.get("cookie"), this.cookieName);
    const match = value ? /^([0-9a-z]+)\.([A-Za-z0-9_-]+)$/.exec(value) : null;
    if (!match) return null;
    const expected = Buffer.from(sign(this.stored.cookieSecret, match[1]!));
    const actual = Buffer.from(match[2]!);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const issuedAt = Number.parseInt(match[1]!, 36);
    const age = this.now() - issuedAt;
    return age >= 0 && age < COOKIE_LIFETIME_MS ? issuedAt : null;
  }

  private issueCookie(request: Request): string {
    const issuedAt = this.now().toString(36);
    return this.cookie(`${issuedAt}.${sign(this.stored!.cookieSecret, issuedAt)}`, COOKIE_LIFETIME_MS / 1000, request);
  }

  private cookie(value: string, maxAgeSeconds: number, request: Request): string {
    const secure = isHttpsRequest(request) ? "; Secure" : "";
    return `${this.cookieName}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`;
  }

  private persist(next: StoredLogin | null): Promise<void> {
    this.stored = next;
    this.pendingWrite = this.pendingWrite.then(async () => {
      if (!next) {
        await rm(this.path, { force: true });
        return;
      }
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(next, null, 2), { encoding: "utf-8", mode: 0o600 });
      await rename(temp, this.path);
    });
    return this.pendingWrite;
  }
}

/** Requests that keep working without a browser login: they carry their own credentials or reveal nothing. */
const PUBLIC_API_PATHS = new Set([
  "/api/auth/status",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/health",
  "/api/ready",
]);
/** Codex sidecar routes accept only loopback callers with the sidecar capability. */
const PUBLIC_API_PREFIX = "/api/integrations/codex/";

/**
 * The 401 response for a request that needs a browser login, or null to let it
 * through. Only the application surface is protected (`/api`, `/ws`, and the
 * HTML file preview); the static frontend stays public so it can show the login
 * screen. Loopback requests are not exempt: tunnels and reverse proxies make
 * outside traffic arrive from 127.0.0.1.
 */
export function loginGate(
  request: Request,
  options: {
    login: BrowserLogin;
    /** Whether the request is an agent CLI carrying a valid session token. */
    hasSessionToken: (request: Request) => boolean;
    /** Paths that authenticate themselves, such as the host link. */
    selfAuthenticatedPaths: string[];
  },
): Response | null {
  const { login } = options;
  if (!login.enabled) return null;
  // Judge both the path the router matches and the fully decoded, dot-resolved
  // one, so encoded slashes or dot segments cannot dress a protected route up
  // as a public one.
  const routed = getPath(request).toLowerCase();
  const normalized = decodeAndNormalizePathname(request.url);
  if (normalized !== null && !isProtectedPath(routed) && !isProtectedPath(normalized)) return null;
  if (routed === normalized && isPublicPath(routed, options.selfAuthenticatedPaths)) return null;
  if (login.isLoggedIn(request) || options.hasSessionToken(request)) return null;
  return new Response(
    JSON.stringify({ error: "Login required. Log in from a browser, or use a valid Takode session token." }),
    {
      status: 401,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", [LOGIN_REQUIRED_HEADER]: "1" },
    },
  );
}

function isProtectedPath(pathname: string): boolean {
  return ["/api", "/ws", "/file-preview"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isPublicPath(pathname: string, selfAuthenticatedPaths: string[]): boolean {
  return (
    PUBLIC_API_PATHS.has(pathname) ||
    pathname.startsWith(PUBLIC_API_PREFIX) ||
    selfAuthenticatedPaths.includes(pathname)
  );
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters`;
  return null;
}

function isHttpsRequest(request: Request): boolean {
  if (new URL(request.url).protocol === "https:") return true;
  return request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https";
}

function readCookie(header: string | null, name: string): string | null {
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator !== -1 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

function sign(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p } = SCRYPT_PARAMS;
  const hash = await scryptAsync(password, salt, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash || password.length > MAX_PASSWORD_LENGTH) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64url"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}

function scryptAsync(password: string, salt: Buffer, params: { N: number; r: number; p: number }): Promise<Buffer> {
  const options: ScryptOptions = { ...params, maxmem: 128 * params.N * params.r * 2 };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, 64, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}
