import { createHash } from "node:crypto";

/**
 * Deterministically stringifies a JSON-serializable value with object keys
 * sorted, so semantically identical inputs always produce the same string
 * regardless of key insertion order.
 */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`,
    );
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

/**
 * `H(canonical task definition)` per CAPABILITY_SPEC.md: a SHA-256 content
 * hash over the value's canonical JSON serialization, not a version number —
 * any change to the value's meaning changes the hash.
 */
export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}
