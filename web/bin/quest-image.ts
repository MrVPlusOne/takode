export interface QuestImageCommandDeps {
  die: (message: string) => never;
  jsonOutput: boolean;
  option: (name: string) => string | undefined;
  out: (value: unknown) => void;
  positional: (index: number) => string | undefined;
  validateFlags: (allowed: string[]) => void;
}

export async function runResizeImageCommand(deps: QuestImageCommandDeps): Promise<void> {
  deps.validateFlags(["max-dim", "json"]);
  const imagePath = deps.positional(0);
  if (!imagePath) deps.die("Usage: quest resize-image <path> [--max-dim 1920]");

  const maxDim = parseMaxDim(deps);
  const sharp = (await import("sharp")).default;
  const { readFile, writeFile } = await import("node:fs/promises");

  let buf: Buffer;
  try {
    buf = (await readFile(imagePath)) as Buffer;
  } catch {
    deps.die(`Cannot read file: ${imagePath}`);
  }

  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) deps.die("Could not read image dimensions");

  if (meta.width <= maxDim && meta.height <= maxDim) {
    if (deps.jsonOutput) {
      deps.out({ resized: false, width: meta.width, height: meta.height, path: imagePath });
    } else {
      console.log(`Already within ${maxDim}px: ${meta.width}×${meta.height}  ${imagePath}`);
    }
    return;
  }

  const resized = await sharp(buf)
    .resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true })
    .toBuffer();
  await writeFile(imagePath, resized);
  const after = await sharp(resized).metadata();

  if (deps.jsonOutput) {
    deps.out({
      resized: true,
      before: { width: meta.width, height: meta.height, bytes: buf.length },
      after: { width: after.width, height: after.height, bytes: resized.length },
      path: imagePath,
    });
    return;
  }

  console.log(
    `Resized: ${meta.width}×${meta.height} → ${after.width}×${after.height}  ` +
      `(${(buf.length / 1024).toFixed(0)}KB → ${(resized.length / 1024).toFixed(0)}KB)  ${imagePath}`,
  );
}

export async function runOptimizeImageCommand(deps: QuestImageCommandDeps): Promise<void> {
  deps.validateFlags(["max-dim", "json"]);
  const imagePath = deps.positional(0);
  if (!imagePath) deps.die("Usage: quest optimize-image <path> [--max-dim 1920] [--json]");

  const maxDim = parseMaxDim(deps);

  try {
    const { optimizeAgentImageFile } = await import("../server/image-optimizer.js");
    const result = await optimizeAgentImageFile(imagePath, { maxDim });

    if (deps.jsonOutput) {
      deps.out(result);
      return;
    }

    if (result.alreadyOptimized) {
      console.log(`Already optimized: ${result.outputPath}`);
      return;
    }

    const before = result.before;
    const after = result.after;
    const beforeDims = before?.width && before?.height ? `${before.width}x${before.height}` : "unknown";
    const afterDims = after?.width && after?.height ? `${after.width}x${after.height}` : "unknown";
    const beforeKb = before?.bytes ? `${(before.bytes / 1024).toFixed(0)}KB` : "unknown";
    const afterKb = after?.bytes ? `${(after.bytes / 1024).toFixed(0)}KB` : "unknown";
    console.log(`Optimized: ${beforeDims} -> ${afterDims}  (${beforeKb} -> ${afterKb})  ${result.outputPath}`);
  } catch (err) {
    deps.die(`Cannot optimize image: ${(err as Error).message}`);
  }
}

function parseMaxDim(deps: QuestImageCommandDeps): number {
  const maxDimStr = deps.option("max-dim");
  const maxDim = maxDimStr ? Number(maxDimStr) : 1920;
  if (!Number.isFinite(maxDim) || maxDim < 1) deps.die("--max-dim must be a positive integer");
  return maxDim;
}
