import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { frontendGzipPlugin } from "./frontend-gzip-plugin.js";

type FixtureOutput =
  | { type: "chunk"; fileName: string; code: string }
  | {
      type: "asset";
      fileName: string;
      source: string | Uint8Array;
    };
async function generate(outputs: FixtureOutput[], fail = false) {
  const hook = frontendGzipPlugin().generateBundle!;
  const handler = typeof hook === "function" ? hook : hook.handler;
  const emitted: { type: string; fileName: string; source: Uint8Array }[] = [];
  const emitFile = vi.fn((file) => {
    if (fail) throw new Error("candidate output failed");
    emitted.push(file);
    return file.fileName;
  });
  await handler.call(
    { emitFile } as unknown as ThisParameterType<typeof handler>,
    {} as Parameters<typeof handler>[0],
    Object.fromEntries(outputs.map((file) => [file.fileName, file])) as unknown as Parameters<typeof handler>[1],
    false,
  );
  return emitted;
}

describe("build-owned gzip companions", () => {
  it("encodes final chunk and stylesheet bytes without changing canonical names or contents", async () => {
    // The hook receives final Rollup output shapes, including binary asset sources.
    const js = 'window.fixture = "content stays exact";\n'.repeat(300);
    const css = new TextEncoder().encode("body { color: #ddd; background: #222; }\n".repeat(300));
    const outputs: FixtureOutput[] = [
      { type: "chunk", fileName: "assets/app-hash.js", code: js },
      { type: "asset", fileName: "assets/app-hash.css", source: css },
    ];
    const before = structuredClone(outputs);
    const emitted = await generate(outputs);
    expect(emitted.map((file) => file.fileName)).toEqual(["assets/app-hash.js.gz", "assets/app-hash.css.gz"]);
    expect(gunzipSync(emitted[0]!.source)).toEqual(Buffer.from(js));
    expect(gunzipSync(emitted[1]!.source)).toEqual(Buffer.from(css));
    expect(emitted[0]!.source.byteLength).toBeLessThan(Buffer.byteLength(js));
    expect(emitted[1]!.source.byteLength).toBeLessThan(css.byteLength);
    expect(outputs).toEqual(before);
    expect(await generate(outputs)).toEqual(emitted);
  });

  it("omits larger companions and excludes HTML, manifests, maps, images and paths outside build assets", async () => {
    const large = "plain fixture".repeat(200);
    const outputs: FixtureOutput[] = [
      { type: "chunk", fileName: "assets/tiny.js", code: "0;" },
      ...[
        "index.html",
        "takode-build.json",
        "assets/app.js.map",
        "assets/icon.svg",
        "assets/app.js.gz",
        "other.js",
        "assets/../escape.js",
      ].map((fileName): FixtureOutput => ({ type: "asset", fileName, source: large })),
    ];
    expect(await generate(outputs)).toEqual([]);
  });

  it("propagates derivative-output failure so candidate preparation cannot publish a partial build", async () => {
    // Existing candidate failure handling owns cleanup and preserves the active snapshot.
    await expect(
      generate([{ type: "chunk", fileName: "assets/app.js", code: "const a = 1;".repeat(200) }], true),
    ).rejects.toThrow("candidate output failed");
  });
});
