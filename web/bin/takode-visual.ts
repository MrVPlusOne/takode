import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseVisualBlock, visualSourceHash } from "../shared/visual-block.js";
import { apiPost } from "./takode-core.js";

export const VISUAL_HELP = `Usage: takode visual preview <file|-> [--out <dir>] [--json]

Render a visual block the way Takode will show it, before you publish it: at a phone's
and a desktop's message width, in dark and light theme. Writes four PNGs and prints
checks (alt text, script errors, sideways scrolling on phones, tiny text, size, time).
Look at the PNGs, fix what's wrong, preview again, then put the same text in a
\`\`\`visual fence.

<file> holds exactly what goes inside the fence: optional "title:" and "alt:" lines,
a "---" line, then the HTML. A file that contains a whole \`\`\`visual fence also works.
Rendering happens on the Takode server, so it works from any machine.
`;

interface PreviewRender {
  label: "phone" | "desktop";
  theme: "dark" | "light";
  status: string;
  width: number;
  height: number;
  settleMs: number;
  elementCount: number;
  detail?: string;
  screenshotPng?: string;
}

export async function handleVisual(base: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (subcommand !== "preview") throw new Error(VISUAL_HELP);
  let input: string | undefined;
  let outDir: string | undefined;
  let json = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--json") json = true;
    else if (arg === "--out") {
      outDir = rest[++i];
      if (!outDir) throw new Error("--out requires a directory.");
    } else if (!input && (arg === "-" || !arg.startsWith("--"))) input = arg;
    else throw new Error(VISUAL_HELP);
  }
  if (!input) throw new Error(VISUAL_HELP);
  const source = unwrapFence(input === "-" ? await readStdin() : await readFile(input, "utf8"));
  const result = (await apiPost(base, "/visuals/preview", { source })) as {
    renders: PreviewRender[];
    checks: Array<{ level: "ok" | "warn" | "error"; text: string }>;
  };
  const dir = resolve(outDir ?? join(tmpdir(), "takode-visual-preview", visualSourceHash(source)));
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (const render of result.renders) {
    if (!render.screenshotPng) continue;
    const file = join(dir, `${render.label}-${render.theme}.png`);
    await writeFile(file, Buffer.from(render.screenshotPng, "base64"));
    files.push(file);
  }
  if (json) {
    console.log(
      JSON.stringify({
        files,
        checks: result.checks,
        renders: result.renders.map(({ screenshotPng: _png, ...render }) => render),
      }),
    );
    return;
  }
  const block = parseVisualBlock(source);
  const phone = result.renders.find((render) => render.label === "phone" && render.theme === "dark");
  console.log(
    `Preview of ${block.title ? `"${block.title}"` : "visual"}` +
      (phone?.status === "ok"
        ? ` (${phone.elementCount} elements, settled in ${Math.max(...result.renders.map((r) => r.settleMs))} ms)`
        : ""),
  );
  for (const render of result.renders) {
    const file = render.screenshotPng ? join(dir, `${render.label}-${render.theme}.png`) : "(no image)";
    console.log(`  ${`${render.label} ${render.theme}`.padEnd(14)} ${render.width}x${render.height}  ${file}`);
  }
  console.log("Checks:");
  for (const check of result.checks) console.log(`  ${check.level.padEnd(5)} ${check.text}`);
  console.log("Look at the images before publishing.");
}

/** Accept a whole ```visual fence as well as its body. */
function unwrapFence(text: string): string {
  const match = /^\s*(`{3,}|~{3,})\s*visual\s*\n([\s\S]*?)\n\s*\1\s*$/.exec(text);
  return (match ? match[2]! : text).replace(/\s+$/, "");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
