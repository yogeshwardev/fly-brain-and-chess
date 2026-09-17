import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const np = (p: string) => fileURLToPath(new URL(`../neuroprison/${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@neuroprison/shared": np("packages/shared/src/index.ts"),
      "@neuroprison/neural-engine": np("packages/neural-engine/src/index.ts"),
      "@neuroprison/simulation-core": np("packages/simulation-core/src/index.ts"),
      "@neuroprison/evolution": np("packages/evolution/src/index.ts"),
      "@neuroprison/chess": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
