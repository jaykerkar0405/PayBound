import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*"],
    environment: "node",
    include: ["**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.svelte-kit/**"],
  },
});
