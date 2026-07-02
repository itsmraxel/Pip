// Parse a numeric environment variable safely. Returns the fallback when the
// value is unset, blank, or not a finite number — so a typo like "high" or a
// locale decimal can't silently turn a threshold into NaN (every comparison
// with NaN is false, which would quietly disable the feature it gates).
export function numEnv(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
