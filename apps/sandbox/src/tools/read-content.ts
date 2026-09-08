/**
 * PayBound Agent Sandbox — Untrusted Content Reading Tool (Task 2.5)
 *
 * This tool allows the agent in the adversarial sandbox domain to read
 * untrusted external content (webpages, documents, tool outputs) per
 * docs/ARCHITECTURE.md and docs/THREAT_MODEL.md.
 *
 * Per docs/TASKS.md Task 2.2:
 * Outbound requests to arbitrary untrusted external endpoints are permitted by the
 * sandbox network egress policy, while direct network routes to payment infrastructure
 * are strictly blocked.
 *
 * SECURITY INVARIANT:
 * This tool returns untrusted data into the LLM context.
 * It contains NO payment-related parameters, no destination field, no amount field,
 * and no capability-granting parameters.
 */

import { tool } from "ai";
import { z } from "zod";

export const readContentInputSchema = z
  .object({
    url: z
      .string()
      .min(1)
      .optional()
      .describe("The URL of external content, webpage, or document to fetch and read"),
    content: z
      .string()
      .optional()
      .describe("Direct untrusted text or document content to inspect"),
  })
  .refine((data) => Boolean(data.url || data.content), {
    message: "Either 'url' or 'content' must be provided",
  });

export type ReadContentInput = z.infer<typeof readContentInputSchema>;

export type ReadContentResult =
  | {
      readonly success: true;
      readonly url: string;
      readonly status: number;
      readonly content: string;
    }
  | {
      readonly success: false;
      readonly url: string;
      readonly error: "fetch_failed";
      readonly message: string;
    };

export interface ReadContentToolOptions {
  readonly fetch?: typeof fetch;
  readonly onRead?: (source: string) => void;
}

/**
 * Executes a content-reading operation. Fetches from a URL via fetch
 * (exercising network egress) or returns direct content.
 */
export async function executeReadContent(
  input: ReadContentInput,
  options: ReadContentToolOptions = {},
): Promise<ReadContentResult> {
  const fetchImpl = options.fetch ?? fetch;

  if (input.url) {
    options.onRead?.(input.url);
    try {
      const response = await fetchImpl(input.url);
      const content = await response.text();
      return {
        success: true,
        url: input.url,
        status: response.status,
        content,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        url: input.url,
        error: "fetch_failed",
        message: `Failed to fetch content from ${input.url}: ${errorMsg}`,
      };
    }
  }

  if (input.content !== undefined) {
    options.onRead?.("direct");
    return {
      success: true,
      url: "direct",
      status: 200,
      content: input.content,
    };
  }

  return {
    success: false,
    url: "",
    error: "fetch_failed",
    message: "Neither url nor content was provided",
  };
}

export interface ReadContentTool {
  readonly description: string;
  readonly inputSchema: typeof readContentInputSchema;
  readonly execute: (input: ReadContentInput) => Promise<ReadContentResult>;
}

/**
 * Creates an instance of the untrusted content-reading tool using Vercel AI SDK.
 */
export function createReadContentTool(options: ReadContentToolOptions = {}): ReadContentTool {
  return tool({
    description:
      "Fetch and read untrusted external content from a URL or inspect direct document text. " +
      "Takes 'url' to fetch from external web/endpoints, or 'content' to inspect text directly.",
    inputSchema: readContentInputSchema,
    execute: async (input: ReadContentInput): Promise<ReadContentResult> => {
      return executeReadContent(input, options);
    },
  }) as unknown as ReadContentTool;
}

/**
 * Default singleton instance of the readContent tool using global fetch.
 */
export const readContentTool: ReadContentTool = createReadContentTool();
