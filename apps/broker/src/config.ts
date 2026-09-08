/**
 * Centralized, environment-derived configuration for the broker service.
 * Other modules should import `config` from here rather than reading
 * `process.env` directly.
 */
export interface Config {
  readonly port: number;
  readonly dbPath: string;
  readonly nodeEnv: string;
}

export const config: Config = {
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? "./broker.db",
  nodeEnv: process.env.NODE_ENV ?? "development",
};
