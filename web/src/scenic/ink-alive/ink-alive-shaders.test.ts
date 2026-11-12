/**
 * The living Ink & Paper shader's sprite reads. The boat and cranes are mipmapped: a texture read
 * skipped by an early return leaves the mip level of the pixels beside it undefined, and on real
 * GPUs the boat then drew a faint, flickering dark box along its edges. Every function that reads
 * a painted layer must therefore read it unconditionally and mask the result.
 */
import { describe, expect, it } from "vitest";
import { INK_ALIVE_SHADER } from "./ink-alive-shaders.js";

/** The body of a GLSL function in the shader, from its signature to its closing brace. */
function functionBody(name: string): string {
  const start = INK_ALIVE_SHADER.search(new RegExp(`\\n\\w+ ${name}\\(`));
  expect(start).toBeGreaterThan(-1);
  const end = INK_ALIVE_SHADER.indexOf("\n}", start);
  return INK_ALIVE_SHADER.slice(start, end);
}

describe("INK_ALIVE_SHADER sprite reads", () => {
  it("reads every painted layer without returning early, so mipmapped sprites keep their mip level", () => {
    for (const name of ["inkAt", "lightAt", "crane"]) {
      const body = functionBody(name);
      expect(body).toContain("texture2D");
      // One return, as the last statement: an earlier one would skip the reads for some pixels.
      expect(body.match(/\breturn\b/g)).toHaveLength(1);
      expect(
        body
          .slice(body.indexOf("return"))
          .trim()
          .split(";")
          .filter((part) => part.trim()),
      ).toHaveLength(1);
    }
  });
});
