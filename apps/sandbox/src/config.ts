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
