/**
 * Centralized, environment-derived configuration for the agent sandbox.
 * Other modules should import `config` from here rather than reading
 * `process.env` directly.
 */
export interface Config {
  readonly brokerHost: string;
  readonly brokerPort: number;
  readonly nodeEnv: string;
}

export const config: Config = {
  brokerHost: process.env.BROKER_HOST ?? "host.docker.internal",
  brokerPort: Number(process.env.BROKER_PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
};

/**
 * Computes the Broker's base URL (no trailing path) from `brokerHost`/`brokerPort`.
 * Shared by every caller that needs to reach the Broker directly (tools/pay.ts,
 * live-run.ts's capability issuance + health check, attest-handshake.ts's caller)
 * so the http(s):// prefixing rule lives in exactly one place.
 */
export function brokerBaseUrl(cfg: Config = config): string {
  return cfg.brokerHost.startsWith("http://") || cfg.brokerHost.startsWith("https://")
    ? `${cfg.brokerHost}:${cfg.brokerPort}`
    : `http://${cfg.brokerHost}:${cfg.brokerPort}`;
}
