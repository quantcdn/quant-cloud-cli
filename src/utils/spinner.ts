import chalk from 'chalk';

// Custom spinner that plays nicely with inquirer. When stdout is not a
// terminal (a pipe, a log file, CI) it draws nothing and only prints the
// final succeed/fail/warn message.
export class CustomSpinner {
  private intervalId?: NodeJS.Timeout;
  private interactive = false;
  private _text: string = '';
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private frameIndex = 0;

  get text() {
    return this._text;
  }

  set text(value: string) {
    this._text = value;
  }

  start(message: string = 'Loading...') {
    this._text = message;
    this.frameIndex = 0;
    this.interactive = Boolean(process.stdout.isTTY);
    if (!this.interactive) {
      return this;
    }
    process.stdout.write(`${this.frames[this.frameIndex]} ${this._text}`);
    
    this.intervalId = setInterval(() => {
      this.clearLine();
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      process.stdout.write(`${this.frames[this.frameIndex]} ${this._text}`);
    }, 80);
    
    return this;
  }

  succeed(message?: string) {
    this.stop();
    if (message) {
      console.log(chalk.green('✔') + ` ${message}`);
    }
  }

  fail(message?: string) {
    this.stop();
    if (message) {
      console.log(chalk.red('✖') + ` ${message}`);
    }
  }

  warn(message?: string) {
    this.stop();
    if (message) {
      console.log(chalk.yellow('⚠') + ` ${message}`);
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.clearLine();
  }

  private clearLine() {
    if (this.interactive) {
      process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');
    }
  }
}

export function createSpinner(message?: string) {
  return new CustomSpinner().start(message);
}