import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Builds the landing page's demo (src/site-demo): the real Takode app with a stand-in server,
 * as one classic script and one stylesheet beside site-demo.html, so the page also works when
 * opened straight from disk, where module scripts are refused.
 */
function classicScript(): Plugin {
  return {
    name: "site-demo-classic-script",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (html) =>
        html.replace(/<script type="module" crossorigin/g, "<script defer").replace(/ crossorigin/g, ""),
    },
  };
}

/**
 * Pages the demo never shows (it plays a leader's view) are left out to keep the download small;
 * opening one shows a short note instead.
 */
const LEFT_OUT_PAGES = [
  "Playground",
  "TerminalPage",
  "SettingsPage",
  "LogsPage",
  "ChangelogPage",
  "MemoryPage",
  "TodosAndTimersPage",
];

function leaveOutPages(): Plugin {
  const prefix = "\0site-demo-left-out:";
  return {
    name: "site-demo-left-out-pages",
    enforce: "pre",
    resolveId(source) {
      const page = LEFT_OUT_PAGES.find((name) => source.endsWith(`/components/${name}.js`));
      return page ? prefix + page : null;
    },
    load(id) {
      if (!id.startsWith(prefix)) return null;
      const name = id.slice(prefix.length);
      return `import { createElement } from "react";
export function ${name}() {
  return createElement("div", { className: "flex h-full items-center justify-center p-8 text-sm text-cc-muted" },
    "This page is not part of the demo. Install Takode to try it.");
}`;
    },
  };
}

/**
 * The files from web/public the demo's screens show. The app names them by absolute path
 * ("/app-logo.png"); the demo serves them from public/ beside its page (see site-demo/main.tsx).
 */
const PUBLIC_ASSETS = [
  "app-logo.png",
  "app-logo-night.png",
  "favicon.png",
  "backend-logos/claude.svg",
  "backend-logos/codex.svg",
  "leader-profile-portraits/tako/tako1-04.v2.96.webp",
  "leader-profile-portraits/tako/tako1-04.v2.320.webp",
  "empty-state/sleeping-tako.v1.320.webp",
];

function copyPublicAssets(): Plugin {
  return {
    name: "site-demo-public-assets",
    apply: "build",
    generateBundle() {
      for (const path of PUBLIC_ASSETS) {
        this.emitFile({ type: "asset", fileName: `public/${path}`, source: readFileSync(`public/${path}`) });
      }
    },
  };
}

export default defineConfig({
  base: "./",
  publicDir: false,
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __TAKODE_BUILD_ID__: JSON.stringify("site-demo"),
  },
  plugins: [leaveOutPages(), react(), tailwindcss(), classicScript(), copyPublicAssets()],
  build: {
    outDir: process.env.SITE_DEMO_OUT ?? "../site/demo/app",
    emptyOutDir: true,
    minify: !process.env.SITE_DEMO_DEBUG,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      input: "site-demo.html",
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "takode-demo.js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
