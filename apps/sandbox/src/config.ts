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
   * Gemini API key pool for the real LLM provider (task 6.1b/6.1b-follow-up,
   * `live-run.ts`'s primary real model, via @ai-sdk/google). Empty array
   * until provisioned — see .env.example. Same optional-until-provisioned
   * convention as `apps/broker/src/config.ts`'s `hederaTestnetAccountId`/
   * `hederaTestnetPrivateKey`: nothing reads this eagerly at import time,
   * so an unset/empty pool only breaks the one code path that actually
   * needs it (`live-run.ts` with `LIVE_RUN_MODEL=real`), never the
   * scripted-model or test paths.
   *
   * Populated from `GEMINI_API_KEY_1`/`_2`/`_3` (up to 3 keys, all
   * optional beyond the first, checked in that order) — RPM/RPD-aware
   * rotation across them lives in `gemini-key-pool.ts`. Falls back to the
   * single `GEMINI_API_KEY` var (PR #87/#88) as a one-key pool when none
   * of the numbered vars are set, so nothing already relying on
   * `GEMINI_API_KEY` alone breaks.
   */
  readonly geminiApiKeys: readonly string[];
  /**
   * Groq API key for the real LLM provider's fallback (task 6.1b,
   * `live-run.ts`, via @ai-sdk/groq) — used only when every configured
   * Gemini key is exhausted (RPM-cooling-down or RPD-exhausted). Same
   * optional-until-provisioned convention as `geminiApiKeys`.
   */
  readonly groqApiKey: string | undefined;
}

/**
 * `GEMINI_API_KEY_1`/`_2`/`_3`, in that order, skipping unset/empty ones.
 * Falls back to the single `GEMINI_API_KEY` var (PR #87/#88's original
 * name) as a one-key pool when none of the numbered vars are set —
 * preserves existing single-key behavior exactly; a caller with only
 * `GEMINI_API_KEY` set sees a pool of size 1, same as before this pool
 * existed.
 */
function resolveGeminiApiKeys(): readonly string[] {
  const numbered = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
  ].filter((key): key is string => key !== undefined && key !== "");

  if (numbered.length > 0) {
    return numbered;
  }

  return process.env.GEMINI_API_KEY ? [process.env.GEMINI_API_KEY] : [];
}

export const config: Config = {
  brokerHost: process.env.BROKER_HOST ?? "host.docker.internal",
  brokerPort: Number(process.env.BROKER_PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  geminiApiKeys: resolveGeminiApiKeys(),
  groqApiKey: process.env.GROQ_API_KEY,
};

/**
 * Computes the Broker's base URL (no trailing path) from `brokerHost`/`brokerPort`.
 * Shared by every caller that needs to reach the Broker directly (tools/pay.ts,
 * live-run.ts's capability issuance + health check, attest-handshake.ts's caller)
 * so the http(s):// prefixing rule lives in exactly one place.
 *
 * When `brokerHost` already carries a protocol (e.g. a real deployed broker's
 * `https://your-broker.onrender.com`), it is treated as a complete origin and
 * used as-is — `brokerPort` is NOT appended. A hosted HTTPS/HTTP endpoint's
 * port (443/80) is implicit; appending a port (e.g. the default 3000) would
 * produce a URL nothing is listening on. A caller that genuinely needs a
 * non-standard port on a protocol-qualified host can just include it in
 * `BROKER_HOST` directly (e.g. "https://example.com:8443"). Only a bare
 * hostname (no protocol) still gets `http://` + the separate port appended,
 * matching every existing local/Docker use (e.g. "host.docker.internal").
 */
export function brokerBaseUrl(cfg: Config = config): string {
  const hasProtocol = cfg.brokerHost.startsWith("http://") || cfg.brokerHost.startsWith("https://");
  return hasProtocol ? cfg.brokerHost : `http://${cfg.brokerHost}:${cfg.brokerPort}`;
}
