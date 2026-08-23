import { defineConfig, loadEnv } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";


/**
 * The one place the public origin is written.
 *
 * Share cards need an absolute `og:image`; a root-relative one is silently
 * dropped by every crawler. The origin comes from `VITE_SITE_URL` and is
 * substituted for `%SITE_URL%` in each entry HTML. When it is unset the token
 * collapses to nothing, so the page still builds with the root-relative paths
 * it has today, and the build says so rather than guessing a domain.
 */
function siteUrl(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const origin = (env.VITE_SITE_URL ?? "").trim().replace(/\/+$/, "");
  if (!origin) {
    console.warn(
      "[wrenchless-hub] VITE_SITE_URL is unset: og:image and canonical will be root-relative and share cards will not render.",
    );
  }
  return {
    name: "wrenchless-site-url",
    transformIndexHtml: (html) => html.replaceAll("%SITE_URL%", origin),
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), siteUrl(mode)],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        privacy: fileURLToPath(new URL("privacy.html", import.meta.url)),
      },
    },
  },
  server: {
    host: true,
    port: 5174,
    strictPort: true,
  },
}));
