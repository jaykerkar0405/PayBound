/**
 * Centralized, environment-derived configuration for the agent sandbox.
 * Other modules should import `config` from here rather than reading
 * `process.env` directly.
 */
export interface Config {
  readonly brokerHost: string;
  readonly brokerPort: number;
  readonly nodeEnv: string;
  /**
   * Gemini API key for the real LLM provider (task 6.1b, `live-run.ts`'s
   * primary real model, via @ai-sdk/google). `undefined` until
   * provisioned — see .env.example. Same optional-until-provisioned
   * convention as `apps/broker/src/config.ts`'s `hederaTestnetAccountId`/
   * `hederaTestnetPrivateKey`: nothing reads this eagerly at import time,
   * so an unset key only breaks the one code path that actually needs it
   * (`live-run.ts` with `LIVE_RUN_MODEL=real`), never the scripted-model
   * or test paths.
   */
  readonly geminiApiKey: string | undefined;
  /**
   * Groq API key for the real LLM provider's fallback (task 6.1b,
   * `live-run.ts`, via @ai-sdk/groq) — used only when the Gemini call
   * fails. Same optional-until-provisioned convention as `geminiApiKey`.
   */
  readonly groqApiKey: string | undefined;
}

export const config: Config = {
  brokerHost: process.env.BROKER_HOST ?? "host.docker.internal",
  brokerPort: Number(process.env.BROKER_PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  geminiApiKey: process.env.GEMINI_API_KEY,
  groqApiKey: process.env.GROQ_API_KEY,
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
