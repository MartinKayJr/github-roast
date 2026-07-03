import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/local.ts", "src/cli.ts", "src/bin.ts"],
  format: ["esm", "cjs"],
  dts: { entry: ["src/index.ts", "src/local.ts"] },
  clean: true,
  sourcemap: true,
  // ESM splitting keeps the heavy local-scoring engine in its own chunk so the
  // CLI only loads it when `--local` is used (dynamic import in cli.ts).
  splitting: true,
  treeshake: true,
  target: "es2021",
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
