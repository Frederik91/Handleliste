import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/acceptance",
  fullyParallel: false,
  retries: 0,
  use: {
    ...devices["Desktop Chrome"],
  },
});
