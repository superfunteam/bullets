import { describe, it, expect } from 'vitest';
import { toDay, weekStart, addDays, daysUntil, weekDays, relativeDay, timeOfDay } from './dates';

describe('dates', () => {
  it('formats a Date as an ISO day string', () => {
    expect(toDay(new Date(2026, 7, 12))).toBe('2026-08-12');
  });

  it('finds Monday as the week start', () => {
    // 2026-08-12 is a Wednesday
    expect(weekStart('2026-08-12')).toBe('2026-08-10');
  });

  it('treats Monday as its own week start', () => {
    expect(weekStart('2026-08-10')).toBe('2026-08-10');
  });

  it('treats Sunday as belonging to the week that started six days earlier', () => {
    expect(weekStart('2026-08-16')).toBe('2026-08-10');
  });

  it('adds days across a month boundary', () => {
    expect(addDays('2026-08-30', 3)).toBe('2026-09-02');
  });

  it('adds days across a year boundary', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('counts days until a future day', () => {
    expect(daysUntil('2026-08-12', '2026-08-15')).toBe(3);
  });

  it('returns a negative count for a past day', () => {
    expect(daysUntil('2026-08-12', '2026-08-09')).toBe(-3);
  });

  it('lists the seven days of a week in order', () => {
    expect(weekDays('2026-08-12')).toEqual([
      '2026-08-10', '2026-08-11', '2026-08-12',
      '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16',
    ]);
  });

  it('phrases nearby days in human terms', () => {
    expect(relativeDay('2026-08-12', '2026-08-12')).toBe('Today');
    expect(relativeDay('2026-08-13', '2026-08-12')).toBe('Tomorrow');
    expect(relativeDay('2026-08-11', '2026-08-12')).toBe('Yesterday');
  });

  it('names a weekday for days later this week', () => {
    expect(relativeDay('2026-08-15', '2026-08-12')).toBe('Sat');
  });

  it('formats times without stray zeroes on the hour', () => {
    expect(timeOfDay(new Date(2026, 7, 12, 10, 0).getTime())).toBe('10am');
    expect(timeOfDay(new Date(2026, 7, 12, 14, 30).getTime())).toBe('2:30pm');
    expect(timeOfDay(new Date(2026, 7, 12, 0, 0).getTime())).toBe('12am');
  });
});
