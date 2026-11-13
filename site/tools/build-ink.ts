// Bundles the app's living Ink & Paper scene and its seal drawing for the landing page,
// so the site shows the same painting as the app. Run from web/:
//   bun --no-install ../site/tools/build-ink.ts
// The scene reads the app store only to react to chat activity; the site stubs it out,
// and image paths come from window.TAKODE_INK_ASSETS instead of the app's /scenic/.
import { resolve } from "node:path";

const siteDir = resolve(import.meta.dir, "..");
const scenic = resolve(siteDir, "../web/src/scenic");
const entry = `
import { startInkAlive, SCENIC_INK_MOMENT_EVENT } from "${scenic}/ink-alive/ink-alive-gl.ts";
import { inkSealSvg } from "${scenic}/ink-celebration.ts";
window.TakodeInk = { start: startInkAlive, MOMENT_EVENT: SCENIC_INK_MOMENT_EVENT, sealSvg: inkSealSvg };
`;

const result = await Bun.build({
  entrypoints: ["ink-entry.ts"],
  minify: true,
  format: "iife",
  plugins: [
    {
      name: "landing-ink",
      setup(build) {
        build.onResolve({ filter: /^ink-entry\.ts$/ }, () => ({ path: "ink-entry.ts", namespace: "entry" }));
        build.onLoad({ filter: /.*/, namespace: "entry" }, () => ({
          contents: entry,
          loader: "ts",
          resolveDir: scenic,
        }));
        build.onResolve({ filter: /store\.js$/ }, () => ({ path: "store-stub", namespace: "stub" }));
        build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: "export const useStore = { subscribe: () => () => {} };",
          loader: "js",
        }));
        build.onLoad({ filter: /ink-alive-gl\.ts$/ }, async (args) => {
          const source = await Bun.file(args.path).text();
          const patched = source.replace(
            "`/scenic/${name}.v1.webp`",
            "`${(window as any).TAKODE_INK_ASSETS ?? '/scenic'}/${name}.v1.webp`",
          );
          // The page pauses the scene while the hero is scrolled away, keeping its GPU state,
          // so coming back needs no fresh minute of cloud simulation.
          const paused = patched.replace(
            "if (document.hidden) return;",
            "if (document.hidden || (window as any).TAKODE_INK_PAUSED) return;",
          );
          // Request the painted layers with CORS, so WebGL may use them when the page is served
          // from another origin or an opaque one (such as Takode's own HTML file viewer).
          const cors = paused.replace(
            'image.decoding = "async";',
            'image.decoding = "async";\n        image.crossOrigin = "anonymous";',
          );
          if (patched === source || paused === patched || cors === paused)
            throw new Error("ink-alive-gl.ts changed in a way this build script does not expect");
          return { contents: cors, loader: "ts" };
        });
      },
    },
  ],
});
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
await Bun.write(resolve(siteDir, "demo/ink-alive.js"), await result.outputs[0].text());
console.log("wrote demo/ink-alive.js", result.outputs[0].size, "bytes");
