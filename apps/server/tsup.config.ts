import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  // Bundle the workspace package (it ships raw TS) into the output so the
  // built server runs without a separate build step for shared.
  noExternal: ["@workation/shared"],
});
