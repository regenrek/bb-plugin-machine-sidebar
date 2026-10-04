import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { environment: "node", include: ["farcall.test.ts", "farcall-workspaces.test.ts", "farcall-workspace-ui.test.tsx", "farcall-refresh.test.ts"], restoreMocks: true },
});
