/** Fixed buckets permit useful fingerprints without error messages or query text. */
export const failureCodes = [
  "postgres_40001",
  "postgres_40P01",
  "postgres_23505",
  "postgres_23503",
  "postgres_22P02",
  "postgres_53300",
  "postgres_53400",
  "postgres_57P01",
  "postgres_08006",
  "postgres_08001",
  "postgres_57014",
  "postgres_other",
  "type_error",
  "range_error",
  "internal_error",
] as const;
export function safeSqlState(error: unknown) {
  try {
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    return typeof code === "string" && /^[A-Z0-9]{5}$/.test(code)
      ? code
      : undefined;
  } catch {
    // Error reporting itself must survive malformed third-party error objects.
    return undefined;
  }
}
export function failureCode(error: unknown): (typeof failureCodes)[number] {
  const state = safeSqlState(error);
  if (state)
    return failureCodes.includes(
      `postgres_${state}` as (typeof failureCodes)[number],
    )
      ? (`postgres_${state}` as (typeof failureCodes)[number])
      : "postgres_other";
  if (error instanceof TypeError) return "type_error";
  if (error instanceof RangeError) return "range_error";
  return "internal_error";
}
