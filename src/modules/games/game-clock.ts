const MINUTE_SECOND_PATTERN = /^(\d{1,2}):(\d{2})$/;
const RAW_SECONDS_PATTERN = /^\d+$/;
/** Generous bound: longest realistic NFL clock value is a 15:00 quarter; double it for safety. */
const MAX_PLAUSIBLE_SECONDS = 1_800;

/**
 * Normalizes the internal `Game.clock` field for public consumption. Highlightly's live
 * game-state clock is raw seconds remaining in the period (e.g. `857`); already-formatted
 * `M:SS` / `MM:SS` values (as used elsewhere, e.g. play-level clocks) pass through unchanged
 * other than stripping a leading zero from the minutes. Malformed or out-of-range input
 * becomes null rather than leaking a provider-specific raw value to frontend consumers.
 */
export function formatGameClock(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();

  const minuteSecondMatch = MINUTE_SECOND_PATTERN.exec(trimmed);
  if (minuteSecondMatch !== null) {
    const minutes = minuteSecondMatch[1];
    const seconds = minuteSecondMatch[2];
    if (minutes === undefined || seconds === undefined || Number(seconds) > 59) return null;
    return `${String(Number(minutes))}:${seconds}`;
  }

  if (RAW_SECONDS_PATTERN.test(trimmed)) {
    const totalSeconds = Number(trimmed);
    if (
      !Number.isInteger(totalSeconds) ||
      totalSeconds < 0 ||
      totalSeconds > MAX_PLAUSIBLE_SECONDS
    ) {
      return null;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
  }

  return null;
}
