import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Resolve the `@/` path alias (from tsconfig `paths`) so tests can import real
// modules by their alias, not only relative paths / mocks.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
