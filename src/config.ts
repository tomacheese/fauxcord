/**
 * 環境変数の読み込みと設定管理
 *
 * サーバー動作に必要な設定値を環境変数から読み込みます。
 */

/** サーバー設定インターフェース */
export interface Config {
  /** リッスンポート */
  port: number;
  /** バインドアドレス */
  host: string;
  /** SQLiteファイルパス */
  dbPath: string;
  /** 添付ファイル保存先ディレクトリ */
  uploadPath: string;
  /** 添付ファイルURL生成に使用するベースURL */
  baseUrl: string;
  /** ログレベル */
  logLevel: "debug" | "info" | "warn" | "error";
  /** trueで任意のトークンを全許可 */
  disableAuth: boolean;
  /** 全レスポンスに付加する人工遅延 (ms) */
  latencyMs: number;
  /** 起動時に自動ロードするJSONファイルのパス */
  seedFile: string | undefined;
}

/**
 * 環境変数から設定を読み込みます。
 * @returns 設定オブジェクト
 */
export function loadConfig(): Config {
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const latencyMs = parseInt(process.env.LATENCY_MS ?? "0", 10);
  const logLevel = process.env.LOG_LEVEL ?? "info";

  return {
    port: isNaN(port) ? 3000 : port,
    host: process.env.HOST ?? "0.0.0.0",
    dbPath: process.env.DB_PATH ?? "/data/mock.db",
    uploadPath: process.env.UPLOAD_PATH ?? "/data/uploads",
    baseUrl: process.env.BASE_URL ?? "http://localhost:3000",
    logLevel: isValidLogLevel(logLevel) ? logLevel : "info",
    disableAuth: process.env.DISABLE_AUTH === "true",
    latencyMs: isNaN(latencyMs) ? 0 : latencyMs,
    seedFile: process.env.SEED_FILE,
  };
}

/**
 * ログレベルの値が有効かどうかを検証します。
 * @param level - 検証するログレベル文字列
 * @returns 有効なログレベルであればtrue
 */
function isValidLogLevel(level: string): level is Config["logLevel"] {
  return ["debug", "info", "warn", "error"].includes(level);
}
