export type DecimalFraction = { numerator: bigint; denominator: bigint };

/** Exact decimal expansion of a finite number (denominators are powers of ten). */
export const decimalFraction = (value: number): DecimalFraction => {
  const [mantissa, exponent = "0"] = value.toString().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const coefficient = BigInt(whole + fraction);
  const shift = Number(exponent) - fraction.length;
  const scale = 10n ** BigInt(Math.abs(shift));
  return { numerator: coefficient * (shift >= 0 ? scale : 1n), denominator: shift < 0 ? scale : 1n };
};

export const addDecimals = (left: DecimalFraction, right: DecimalFraction): DecimalFraction => {
  // Decimal denominators are powers of ten, so the larger is a common denominator.
  const denominator = left.denominator > right.denominator ? left.denominator : right.denominator;
  return { numerator: left.numerator * (denominator / left.denominator) + right.numerator * (denominator / right.denominator), denominator };
};

export const withinTolerance = (difference: bigint, denominator: bigint, tolerance: number): boolean => {
  const margin = decimalFraction(tolerance);
  const magnitude = difference < 0n ? -difference : difference;
  return magnitude * margin.denominator <= margin.numerator * denominator;
};

// Round a scaled decimal half-up without binary multiplication at a rounding boundary.
export const roundDecimal = (value: unknown, multiplier: bigint, divisor: bigint): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  const fraction = decimalFraction(value);
  const numerator = fraction.numerator * multiplier;
  const denominator = fraction.denominator * divisor;
  const rounded = (numerator + denominator / 2n) / denominator;
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) : undefined;
};

export const decimalCents = (value: unknown): number | undefined => roundDecimal(value, 100n, 1n);
