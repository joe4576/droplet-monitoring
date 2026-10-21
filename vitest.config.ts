import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    environment: "node",
    include: ["worker/**/*.test.ts"],
    restoreMocks: true,
  },
});
