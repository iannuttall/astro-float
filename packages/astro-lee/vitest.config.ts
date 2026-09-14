import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.{js,ts}"],
    // Browser-side modules (html-to-md, editor, embeds) say `// @vitest-environment jsdom` at the top.
    environment: "node",
  },
});
