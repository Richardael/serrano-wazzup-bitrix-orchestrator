import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/integration/**/*.spec.ts"],
    setupFiles: ["test/integration/setup.ts"],
  },
});
