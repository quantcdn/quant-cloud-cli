import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createSpinner } from '../../src/utils/spinner.js';

describe('CustomSpinner', () => {
  let writeSpy: any;
  let consoleSpy: any;
  const originalIsTTY = process.stdout.isTTY;

  const setTTY = (value: boolean | undefined) => {
    Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    writeSpy.mockRestore();
    consoleSpy.mockRestore();
    setTTY(originalIsTTY);
  });

  describe('when stdout is not a terminal', () => {
    beforeEach(() => setTTY(undefined));

    it('writes no frames or line clears', () => {
      const spinner = createSpinner('Working...');
      jest.advanceTimersByTime(1000);
      spinner.stop();

      expect(writeSpy).not.toHaveBeenCalled();
    });

    it('still prints the result message', () => {
      createSpinner('Working...').succeed('Done');

      expect(writeSpy).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(String(consoleSpy.mock.calls[0][0])).toContain('Done');
    });

    it('prints fail and warn messages', () => {
      createSpinner().fail('Broken');
      createSpinner().warn('Careful');

      expect(writeSpy).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('when stdout is a terminal', () => {
    beforeEach(() => setTTY(true));

    it('animates frames until stopped', () => {
      const spinner = createSpinner('Working...');
      jest.advanceTimersByTime(250);
      const writesWhileRunning = writeSpy.mock.calls.length;
      spinner.stop();
      const writesAtStop = writeSpy.mock.calls.length;
      jest.advanceTimersByTime(1000);

      expect(writesWhileRunning).toBeGreaterThan(1);
      expect(String(writeSpy.mock.calls[0][0])).toContain('Working...');
      expect(writeSpy.mock.calls.length).toBe(writesAtStop);
    });
  });
});
