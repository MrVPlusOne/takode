import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkFrontendAvailability } from "./frontend-availability.js";

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "takode-frontend-availability-"));
  tempRoots.push(root);
  return root;
}

async function writeFrontendFile(root: string, relativePath: string, content = "fixture"): Promise<void> {
  const target = join(root, relativePath);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, content, "utf-8");
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("checkFrontendAvailability", () => {
  it("is ready without touching an absent frontend when production assets are not required", async () => {
    // Development serves the UI through Vite, so an intentionally absent dist directory must not make the API unready.
    const result = await checkFrontendAvailability({
      required: false,
      frontendRoot: join(tmpdir(), "takode-dist-does-not-exist"),
    });

    expect(result).toEqual({ required: false, ready: true, reason: "not_required" });
  });

  it("requires index.html and every local script, stylesheet, and manifest reference to be a file", async () => {
    const root = await createTempRoot();
    await writeFrontendFile(
      root,
      "index.html",
      `<!doctype html>
<html>
  <head>
    <link href="/manifest.json?build=1" rel="manifest">
    <link rel='stylesheet alternate' href='./assets/app.css#theme'>
    <script src="assets/app.js?v=2" type="module"></script>
    <script src="https://cdn.example.invalid/optional.js"></script>
  </head>
</html>`,
    );
    await writeFrontendFile(root, "manifest.json", "{}");
    await writeFrontendFile(root, "assets/app.css", "body {}");
    await writeFrontendFile(root, "assets/app.js", "export {};");

    // Remote scripts are outside Takode's publication boundary; only local build artifacts are checked.
    await expect(checkFrontendAvailability({ required: true, frontendRoot: root })).resolves.toEqual({
      required: true,
      ready: true,
      reason: "ready",
    });
  });

  it("rejects index HTML that cannot boot the local application", async () => {
    const root = await createTempRoot();
    await writeFrontendFile(
      root,
      "index.html",
      '<html><script src="https://cdn.example.invalid/remote.js"></script></html>',
    );

    // An HTML shell or remote-only script can return HTTP 200 while still lacking Takode's local app and PWA manifest.
    await expect(checkFrontendAvailability({ required: true, frontendRoot: root })).resolves.toEqual({
      required: true,
      ready: false,
      reason: "index_invalid",
    });
  });

  it("reports a stable generic reason when the production index is absent", async () => {
    const root = await createTempRoot();
    const result = await checkFrontendAvailability({ required: true, frontendRoot: root });

    expect(result).toEqual({ required: true, ready: false, reason: "index_unavailable" });
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it("fails readiness when a referenced local artifact is absent or is a directory", async () => {
    const root = await createTempRoot();
    await writeFrontendFile(root, "index.html", '<script type="module" src="/assets/app.js"></script>');
    await mkdir(join(root, "assets", "app.js"), { recursive: true });

    // HTTP SPA fallbacks can turn a missing asset into index HTML with status 200, so readiness checks the file itself.
    const result = await checkFrontendAvailability({ required: true, frontendRoot: root });
    expect(result).toEqual({ required: true, ready: false, reason: "reference_unavailable" });
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it("rejects a local reference whose resolved file escapes through a symlink", async () => {
    const root = await createTempRoot();
    const outsideRoot = await createTempRoot();
    await writeFrontendFile(root, "index.html", '<link rel="stylesheet" href="/assets/app.css">');
    await writeFrontendFile(outsideRoot, "app.css", "body {}");
    await mkdir(join(root, "assets"), { recursive: true });
    await symlink(join(outsideRoot, "app.css"), join(root, "assets", "app.css"));

    // Lexical containment is insufficient here: realpath containment prevents a crafted build tree from probing outside dist.
    const result = await checkFrontendAvailability({ required: true, frontendRoot: root });
    expect(result).toEqual({ required: true, ready: false, reason: "reference_invalid" });
    expect(JSON.stringify(result)).not.toContain(outsideRoot);
  });

  it("rejects malformed encoded local paths without returning the reference", async () => {
    const root = await createTempRoot();
    await writeFrontendFile(root, "index.html", '<script src="/assets/%E0%A4%A.js"></script>');

    const result = await checkFrontendAvailability({ required: true, frontendRoot: root });
    expect(result).toEqual({ required: true, ready: false, reason: "reference_invalid" });
    expect(JSON.stringify(result)).not.toContain("%E0%A4%A.js");
  });
});
