import { defineConfig } from "vitest/config";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [viteSingleFile()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // A stray .only must never hide other tests (e.g. the mandatory integration sites).
    allowOnly: false,
    coverage: { include: ["src/core/**"] },
  },
});
