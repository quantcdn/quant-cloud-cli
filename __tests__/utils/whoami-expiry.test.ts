import { describe, it, expect } from '@jest/globals';
import { formatTimeLeft } from '../../src/commands/whoami.js';

const HOUR = 60 * 60 * 1000;

describe('formatTimeLeft', () => {
  it('shows days when more than 48 hours are left', () => {
    expect(formatTimeLeft(90 * 24 * HOUR)).toBe('90 days');
    expect(formatTimeLeft(49 * HOUR)).toBe('2 days');
  });

  it('shows expired when no time is left', () => {
    expect(formatTimeLeft(0)).toBe('expired');
    expect(formatTimeLeft(-HOUR)).toBe('expired');
  });

  it('shows hours and minutes for 48 hours or less', () => {
    expect(formatTimeLeft(48 * HOUR)).toBe('48h 0m');
    expect(formatTimeLeft(5 * HOUR + 20 * 60 * 1000)).toBe('5h 20m');
  });
});
