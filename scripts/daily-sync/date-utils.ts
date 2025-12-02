/**
 * Date utility functions for the daily sync job.
 */

export const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Get 24 hours from the given date (or now) in ISO 8601 format.
 */
export function get24HoursFromDate(date: Date = new Date()): string {
  const tomorrow = new Date(date.getTime() + DAY_IN_MS);
  return tomorrow.toISOString();
}

/**
 * Get the next Wednesday at 8 AM UTC that is strictly after the given date.
 * This is treated as the end of the current NFL week.
 */
export function getEndOfCurrentNFLWeek(date: Date = new Date()): string {
  const currentDay = date.getUTCDay(); // 0 = Sunday ... 3 = Wednesday
  const targetDay = 3; // Wednesday
  let daysUntilWednesday = (targetDay - currentDay + 7) % 7;

  // Treat Tuesday and Wednesday as part of the "next" NFL week window
  if (currentDay === 2 || currentDay === 3) {
    daysUntilWednesday += 7;
  }

  let candidate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + daysUntilWednesday, 8, 0, 0, 0)
  );

  if (candidate <= date) {
    candidate = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + daysUntilWednesday + 7, 8, 0, 0, 0)
    );
  }

  return candidate.toISOString();
}
