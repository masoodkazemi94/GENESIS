/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const TICKS_PER_DAY = 2400; // 20 Hz fixed step: 2400 ticks = 120s (2 minutes real-time per day)
export const DAYS_PER_YEAR = 4;    // 4 days per simulated year (1 day per season)
export const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR; // 9600 ticks = 480s (8 minutes real-time)

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type TimeOfDay = 'Dawn' | 'Midday' | 'Dusk' | 'Night';

export interface CalendarDate {
  tick: number;
  year: number;          // 1-indexed (Year 1, 2, ...)
  dayOfYear: number;     // 1 to 4
  season: Season;
  dayCycle: number;      // 0.0 to 1.0 (sun position / progress through the day)
  timeOfDay: TimeOfDay;
  totalDays: number;     // 1-indexed cumulative days
}

/**
 * Authoritative calendar calculation shared by climate, engine, HUD, events, and persistence.
 * Day 1 = Spring
 * Day 2 = Summer
 * Day 3 = Autumn
 * Day 4 = Winter
 */
export function getCalendarDate(tick: number): CalendarDate {
  const safeTick = Math.max(0, Math.floor(tick));
  const year = Math.floor(safeTick / TICKS_PER_YEAR) + 1;
  const tickInYear = safeTick % TICKS_PER_YEAR;
  const dayOfYear = Math.floor(tickInYear / TICKS_PER_DAY) + 1; // 1, 2, 3, or 4
  const totalDays = Math.floor(safeTick / TICKS_PER_DAY) + 1;
  const dayCycle = (safeTick % TICKS_PER_DAY) / TICKS_PER_DAY;

  let season: Season;
  switch (dayOfYear) {
    case 1:
      season = 'spring';
      break;
    case 2:
      season = 'summer';
      break;
    case 3:
      season = 'autumn';
      break;
    case 4:
    default:
      season = 'winter';
      break;
  }

  let timeOfDay: TimeOfDay = 'Dawn';
  if (dayCycle >= 0.18 && dayCycle < 0.42) {
    timeOfDay = 'Midday';
  } else if (dayCycle >= 0.42 && dayCycle < 0.58) {
    timeOfDay = 'Dusk';
  } else if (dayCycle >= 0.58) {
    timeOfDay = 'Night';
  }

  return {
    tick: safeTick,
    year,
    dayOfYear,
    season,
    dayCycle,
    timeOfDay,
    totalDays,
  };
}

export function formatCalendarDate(date: CalendarDate): string {
  const seasonCapitalized = date.season.charAt(0).toUpperCase() + date.season.slice(1);
  return `Year ${date.year}, Day ${date.dayOfYear} (${seasonCapitalized}) • ${date.timeOfDay}`;
}
