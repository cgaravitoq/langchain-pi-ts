import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/opencode-chat.ts"],
  format: ["esm"],
  dts: true,
  target: "node22",
  clean: true,
  sourcemap: true,
});
