import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/** The `takode node` entry point, relative to the Takode checkout's `web` folder. */
const NODE_ENTRY = "bin/takode-node.ts";

/**
 * Fingerprint of the code a `takode node` started from the Takode checkout at
 * `webRoot` loads when it starts: every file its entry point imports, directly
 * or through other files, with their contents. Modules it imports only later
 * with `import()` (the host operations and setup a node on another machine
 * runs) are left out, as is code the node never loads, so a change elsewhere
 * in Takode leaves the fingerprint unchanged and the node need not restart.
 * The lockfile counts when that code imports installed packages. Null when
 * the files cannot be read or bundled.
 */
export async function nodeCodeFingerprint(webRoot: string): Promise<string | null> {
  try {
    const code = await nodeCodeFiles(webRoot);
    if (!code) return null;
    const { files, usesPackages } = code;
    const hash = createHash("sha256");
    for (const file of files) {
      hash.update(`${file}\0`);
      hash.update(await readFile(join(webRoot, file)));
      hash.update("\0");
    }
    if (usesPackages) hash.update(await readFile(join(webRoot, "bun.lock")));
    return hash.digest("hex");
  } catch (error) {
    console.warn(`[node-code] Could not fingerprint the node's code in ${webRoot}:`, error);
    return null;
  }
}

/**
 * The files `nodeCodeFingerprint` covers, relative to `webRoot` and sorted,
 * and whether they import an installed package; null when they cannot be bundled.
 */
export async function nodeCodeFiles(webRoot: string): Promise<{ files: string[]; usesPackages: boolean } | null> {
  const build = await Bun.build({
    entrypoints: [join(webRoot, NODE_ENTRY)],
    target: "bun",
    packages: "external",
    metafile: true,
  });
  if (!build.success || !build.metafile) return null;
  return loadedAtStart(build.metafile.inputs, webRoot);
}

type MetafileInputs = Record<string, { imports: Array<{ path: string; kind: string; external?: boolean }> }>;

/** The files reachable from the entry point through static imports, sorted, and whether any imports a package. */
function loadedAtStart(inputs: MetafileInputs, webRoot: string): { files: string[]; usesPackages: boolean } {
  // Metafile keys are relative to the working directory; import paths are absolute.
  const byFile = new Map(Object.entries(inputs).map(([key, input]) => [relative(webRoot, resolve(key)), input]));
  const files = new Set<string>();
  const pending = [NODE_ENTRY];
  let usesPackages = false;
  while (pending.length > 0) {
    const file = pending.pop()!;
    const input = byFile.get(file);
    if (files.has(file) || !input) continue;
    files.add(file);
    for (const imported of input.imports) {
      if (imported.kind !== "import-statement") continue;
      if (imported.external) {
        usesPackages ||= !isBuiltin(imported.path);
        continue;
      }
      pending.push(importedFile(byFile, webRoot, file, imported.path));
    }
  }
  return { files: [...files].sort(), usesPackages };
}

/**
 * The file an import names, relative to `webRoot`. Bun's metafile gives most
 * import paths resolved, but some only as written in the importing file.
 */
function importedFile(byFile: Map<string, unknown>, webRoot: string, importer: string, path: string): string {
  if (isAbsolute(path)) return relative(webRoot, path);
  const written = relative(webRoot, resolve(webRoot, dirname(importer), path));
  return (
    [written, written.replace(/\.js$/, ".ts"), written.replace(/\.js$/, ".tsx")].find((f) => byFile.has(f)) ?? written
  );
}

function isBuiltin(specifier: string): boolean {
  const name = specifier.replace(/^node:/, "");
  return specifier.startsWith("bun:") || specifier === "bun" || builtinModules.includes(name.split("/")[0]!);
}
