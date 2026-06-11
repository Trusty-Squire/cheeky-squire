import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Fixtures and temp git repos make file I/O serial-friendly; keep it simple.
    pool: "forks",
    testTimeout: 30_000,
  },
});
