import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { Plugin } from "vite";
import { isFrontendCodeAsset } from "../shared/frontend-assets.js";

const encodeGzip = promisify(gzip);

/** Emit smaller, lossless gzip companions from the final JS/CSS bytes of this build. */
export function frontendGzipPlugin(): Plugin {
  return {
    name: "frontend-gzip-assets",
    apply: "build",
    generateBundle: {
      order: "post",
      async handler(_options, bundle) {
        // Sequential compression bounds transient memory to one asset and propagates build failures.
        for (const output of Object.values(bundle)) {
          if (!isFrontendCodeAsset(output.fileName)) continue;
          const source = output.type === "chunk" ? output.code : output.source;
          const original = Buffer.from(source);
          const encoded = await encodeGzip(original);
          if (encoded.byteLength >= original.byteLength) continue;
          this.emitFile({ type: "asset", fileName: `${output.fileName}.gz`, source: encoded });
        }
      },
    },
  };
}
