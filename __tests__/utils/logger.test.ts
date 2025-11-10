import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Logger, LogLevel } from '../../src/utils/logger.js';

describe('Logger', () => {
  let consoleSpy: any;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    delete process.env.LOG_LEVEL;
  });

  describe('constructor', () => {
    it('should create a logger with a context', () => {
      const logger = new Logger('TestContext');
      expect(logger).toBeDefined();
    });

    it('should set log level from environment variable', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      const logger = new Logger('TestContext');
      
      logger.debug('debug message');
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should default to INFO level when no environment variable is set', () => {
      const logger = new Logger('TestContext');
      
      logger.debug('debug message');
      expect(consoleSpy).not.toHaveBeenCalled();
      
      logger.info('info message');
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('debug', () => {
    it('should log debug messages when level is DEBUG', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      const logger = new Logger('TestContext');
      
      logger.debug('debug message');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[TestContext] DEBUG: debug message')
      );
    });

    it('should not log debug messages when level is INFO', () => {
      process.env.LOG_LEVEL = 'INFO';
      const logger = new Logger('TestContext');
      
      logger.debug('debug message');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should pass additional arguments', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      const logger = new Logger('TestContext');
      const obj = { key: 'value' };
      
      logger.debug('debug message', obj);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('debug message'),
        obj
      );
    });
  });

  describe('info', () => {
    it('should log info messages when level is INFO or lower', () => {
      const logger = new Logger('TestContext');
      
      logger.info('info message');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[TestContext]'),
        'info message'
      );
    });

    it('should not log info messages when level is WARN', () => {
      process.env.LOG_LEVEL = 'WARN';
      const logger = new Logger('TestContext');
      
      logger.info('info message');
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('warn', () => {
    it('should log warn messages', () => {
      const logger = new Logger('TestContext');
      
      logger.warn('warning message');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[TestContext] WARN: warning message')
      );
    });

    it('should log warn messages at WARN level', () => {
      process.env.LOG_LEVEL = 'WARN';
      const logger = new Logger('TestContext');
      
      logger.warn('warning message');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should not log warn messages when level is ERROR', () => {
      process.env.LOG_LEVEL = 'ERROR';
      const logger = new Logger('TestContext');
      
      logger.warn('warning message');
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('error', () => {
    it('should log error messages', () => {
      const logger = new Logger('TestContext');
      
      logger.error('error message');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[TestContext] ERROR: error message')
      );
    });

    it('should log error messages at all log levels', () => {
      process.env.LOG_LEVEL = 'ERROR';
      const logger = new Logger('TestContext');
      
      logger.error('error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should pass additional arguments', () => {
      const logger = new Logger('TestContext');
      const error = new Error('test error');
      
      logger.error('error message', error);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('error message'),
        error
      );
    });
  });

  describe('LogLevel enum', () => {
    it('should have correct severity ordering', () => {
      expect(LogLevel.DEBUG).toBeLessThan(LogLevel.INFO);
      expect(LogLevel.INFO).toBeLessThan(LogLevel.WARN);
      expect(LogLevel.WARN).toBeLessThan(LogLevel.ERROR);
    });
  });
});

