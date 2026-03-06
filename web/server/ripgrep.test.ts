import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const mockAccess = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, access: mockAccess };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, exec: mockExec };
});

// ─── Import after mocks ─────────────────────────────────────────────────────

// Dynamic import to reset the module cache between tests (since it caches the result)
async function freshImport() {
  vi.resetModules();
  return import("./ripgrep.js");
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("getRipgrepPath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the SDK vendored binary when it exists", async () => {
    const { getRipgrepPath } = await freshImport();
    // access() succeeds — file exists
    mockAccess.mockResolvedValue(undefined);

    const result = await getRipgrepPath();
    // Should contain the vendor path with arch-platform directory
    expect(result).toContain("vendor/ripgrep/");
    expect(result).toContain("/rg");
    expect(result).not.toBe("rg"); // Not the bare fallback
  });

  it("falls back to system rg when SDK binary is missing", async () => {
    const { getRipgrepPath } = await freshImport();
    let callCount = 0;
    // access() fails for SDK path, succeeds for system path
    mockAccess.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("ENOENT"); // SDK path
      // System path check succeeds
    });
    // exec() for 'which rg' returns system path
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb?: Function) => {
      if (cb) cb(null, { stdout: "/usr/bin/rg\n" });
      return {} as any;
    });

    const result = await getRipgrepPath();
    expect(result).toBe("/usr/bin/rg");
  });

  it("returns bare 'rg' when neither SDK nor system binary exists", async () => {
    const { getRipgrepPath } = await freshImport();
    // access() always fails — no binary anywhere
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    // exec() for 'which rg' fails
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb?: Function) => {
      if (cb) cb(new Error("not found"), { stdout: "" });
      return {} as any;
    });

    const result = await getRipgrepPath();
    expect(result).toBe("rg");
  });

  it("caches the result after first call", async () => {
    const { getRipgrepPath } = await freshImport();
    mockAccess.mockResolvedValue(undefined);

    const first = await getRipgrepPath();
    mockAccess.mockClear();
    const second = await getRipgrepPath();

    expect(first).toBe(second);
    // access() should NOT be called again (result was cached)
    expect(mockAccess).not.toHaveBeenCalled();
  });
});
