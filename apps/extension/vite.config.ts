import { crx } from "@crxjs/vite-plugin";
import { defineConfig, loadEnv } from "vite";
import { buildManifest } from "./manifest.config";

export default defineConfig(({ mode }) => {
  // Load .env files (all keys, no prefix filter) so the manifest can read the
  // OAuth client ID at build time.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [crx({ manifest: buildManifest(env) })],
    server: {
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5173,
      },
    },
  };
});
