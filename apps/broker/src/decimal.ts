/**
 * Exact decimal-string arithmetic, backed by BigInt — deliberately avoids
 * native JS floating-point `+`/`<=` on Decimal values (per
 * packages/types/src/index.ts's `decimalSchema`: amounts are strings
 * specifically to avoid floating-point drift, e.g. `0.1 + 0.2 !== 0.3` in
 * native JS). Used by the budget tracker's over-budget check, where an
 * off-by-a-rounding-error comparison at the boundary would be a real
 * security bug.
 */

function splitDecimal(value: string): { negative: boolean; integer: string; fraction: string } {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [integer = "0", fraction = ""] = unsigned.split(".");
  return { negative, integer: integer === "" ? "0" : integer, fraction };
}

function toScaledBigInt(value: string, scale: number): bigint {
  const { negative, integer, fraction } = splitDecimal(value);
  const paddedFraction = fraction.padEnd(scale, "0").slice(0, scale);
  const magnitude = BigInt(`${integer}${paddedFraction}`);
  return negative ? -magnitude : magnitude;
}

function fromScaledBigInt(value: bigint, scale: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const digits = abs.toString().padStart(scale + 1, "0");
  const integer = digits.slice(0, digits.length - scale);
  const fraction = scale > 0 ? digits.slice(digits.length - scale) : "";
  const unsigned = scale > 0 ? `${integer}.${fraction}` : integer;
  return negative && unsigned !== "0" ? `-${unsigned}` : unsigned;
}

function commonScale(a: string, b: string): number {
  return Math.max(splitDecimal(a).fraction.length, splitDecimal(b).fraction.length);
}

/** Exact `a + b` for two Decimal strings, with no floating-point drift. */
export function addDecimalStrings(a: string, b: string): string {
  const scale = commonScale(a, b);
  return fromScaledBigInt(toScaledBigInt(a, scale) + toScaledBigInt(b, scale), scale);
}

/** Exact three-way comparison of two Decimal strings: -1 if a<b, 0 if a===b, 1 if a>b. */
export function compareDecimalStrings(a: string, b: string): -1 | 0 | 1 {
  const scale = commonScale(a, b);
  const scaledA = toScaledBigInt(a, scale);
  const scaledB = toScaledBigInt(b, scale);
  if (scaledA < scaledB) return -1;
  if (scaledA > scaledB) return 1;
  return 0;
}
