import type { HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { optimizeImageBufferForStore } from "./image-optimizer.js";

/**
 * What Claude Code's Read tool returns for an image file (checked against
 * 2.1.311): the base64 it sends to the model, its media type, and the sizes.
 */
interface ReadImageOutput {
  type: "image";
  file: {
    base64: string;
    type: string;
    originalSize?: number;
    dimensions?: Record<string, number>;
  };
}

/** Images below this (base64 characters) go as they are: re-encoding them saves too little to matter. */
const MIN_SHRINK_BASE64_CHARS = 64 * 1024;
const SHRINKABLE_TYPES = new Set(["image/png", "image/jpeg"]);

/**
 * Claude PostToolUse hook that re-encodes large PNG and JPEG images Read
 * returns as quality-90 WebP before Claude Code sends them to the model.
 *
 * Every image an agent reads stays in each later request until compaction,
 * and request bytes, not tokens, run out first: a CAD session on the laptop
 * failed every request with Copilot's 408 ("Timed out reading request body",
 * 60 s) at about 11 MB of PNG renders, which were only ~70K tokens. WebP keeps
 * the pixels the model sees at about a fifth of a render's PNG bytes. Claude
 * Code records the rewritten output in its transcript, so resumes keep it too.
 * Running as a hook makes it independent of agents remembering to optimize.
 */
export const claudeReadImageHook: HookCallbackMatcher = {
  matcher: "Read",
  hooks: [
    async (input) => {
      if (input.hook_event_name !== "PostToolUse") return {};
      const shrunk = await shrinkReadImageOutput(input.tool_response);
      if (!shrunk) return {};
      return { hookSpecificOutput: { hookEventName: "PostToolUse" as const, updatedToolOutput: shrunk } };
    },
  ],
};

/**
 * The Read output with its image re-encoded smaller, or null when it is not a
 * large PNG/JPEG image or the encode would not make it smaller.
 */
export async function shrinkReadImageOutput(output: unknown): Promise<ReadImageOutput | null> {
  if (!isReadImageOutput(output)) return null;
  const { file } = output;
  if (!SHRINKABLE_TYPES.has(file.type) || file.base64.length < MIN_SHRINK_BASE64_CHARS) return null;
  try {
    const result = await optimizeImageBufferForStore(Buffer.from(file.base64, "base64"), file.type);
    if (!result.reencoded) return null;
    const { width, height } = result.after ?? {};
    return {
      ...output,
      file: {
        ...file,
        base64: result.data.toString("base64"),
        type: result.mediaType,
        ...(file.dimensions && width && height
          ? { dimensions: { ...file.dimensions, displayWidth: width, displayHeight: height } }
          : {}),
      },
    };
  } catch (err) {
    console.warn("[claude-read-image] Could not shrink an image Read returned; sending it as it is:", err);
    return null;
  }
}

function isReadImageOutput(output: unknown): output is ReadImageOutput {
  const file = (output as { type?: unknown; file?: { base64?: unknown; type?: unknown } } | null)?.file;
  return (
    (output as { type?: unknown } | null)?.type === "image" &&
    typeof file?.base64 === "string" &&
    typeof file.type === "string"
  );
}
