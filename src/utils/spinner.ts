import chalk from 'chalk';

// Custom spinner that plays nicely with inquirer
export class CustomSpinner {
  private intervalId?: NodeJS.Timeout;
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
    process.stdout.write(`${this.frames[this.frameIndex]} ${this._text}`);
    
    this.intervalId = setInterval(() => {
      process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      process.stdout.write(`${this.frames[this.frameIndex]} ${this._text}`);
    }, 80);
    
    return this;
  }

  succeed(message?: string) {
    this.stop();
    process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');
    if (message) {
      console.log(chalk.green('✔') + ` ${message}`);
    }
  }

  fail(message?: string) {
    this.stop();
    process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');
    if (message) {
      console.log(chalk.red('✖') + ` ${message}`);
    }
  }

  warn(message?: string) {
    this.stop();
    process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');
    if (message) {
      console.log(chalk.yellow('⚠') + ` ${message}`);
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');
  }
}

export function createSpinner(message?: string) {
  return new CustomSpinner().start(message);
}