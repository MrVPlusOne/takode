import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {
  generateTakodeBuildId,
  normalizeTakodeBuildId,
  serializeTakodeBuildManifest,
  TAKODE_BUILD_MANIFEST_FILENAME,
  TAKODE_DEVELOPMENT_BUILD_ID,
} from "./server/build-identity.js";

const backendPort = Number(process.env.PORT) || 3457;

function buildManifestPlugin(buildId: string): Plugin {
  return {
    name: "takode-build-manifest",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: TAKODE_BUILD_MANIFEST_FILENAME,
        source: serializeTakodeBuildManifest(buildId),
      });
    },
  };
}

export default defineConfig(({ command }) => {
  const buildId =
    command === "serve"
      ? TAKODE_DEVELOPMENT_BUILD_ID
      : (normalizeTakodeBuildId(process.env.TAKODE_BUILD_ID) ?? generateTakodeBuildId());

  return {
    define: {
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      __TAKODE_BUILD_ID__: JSON.stringify(buildId),
    },
    plugins: [react(), tailwindcss(), buildManifestPlugin(buildId)],
    server: {
      host: "0.0.0.0",
      port: 5174,
      proxy: {
        "/api": `http://localhost:${backendPort}`,
        "/file-preview": `http://localhost:${backendPort}`,
        "/ws": {
          target: `ws://localhost:${backendPort}`,
          ws: true,
        },
      },
    },
  };
});
