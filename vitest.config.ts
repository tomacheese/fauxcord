import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // テスト環境設定
    environment: "node",
    // グローバル変数を使用しない（明示的インポートを強制）
    globals: false,
    // カバレッジ設定
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
    },
    // テストファイルのパターン
    include: ["src/**/*.test.ts"],
  },
});
