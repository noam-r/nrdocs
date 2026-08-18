import type { Runtime } from './runtime.js';

const SPINNER = '|/-\\';
const SPIN_MS = 80;

export type StatusReporter = {
  /** Named phase. Always shown; TTY updates in place, otherwise one stderr line. */
  phase(label: string): void;
  /** Fine-grained TTY-only update (ignored when stderr is not a TTY). */
  tick(label: string): void;
  /** Clear an in-place TTY line. Safe to call more than once. */
  stop(): void;
};

/**
 * Live status for long commands. Writes stderr only so stdout stays the result.
 */
export function createStatusReporter(runtime: Runtime): StatusReporter {
  const tty = runtime.stderrIsTTY;
  let timer: ReturnType<typeof setInterval> | undefined;
  let frame = 0;
  let current = '';
  let paintedWidth = 0;

  const paint = (): void => {
    const line = `${SPINNER[frame % SPINNER.length]!} ${current}`;
    const pad = paintedWidth > line.length ? ' '.repeat(paintedWidth - line.length) : '';
    runtime.io.writeStderr(`\r${line}${pad}`);
    paintedWidth = Math.max(paintedWidth, line.length);
  };

  const startSpin = (): void => {
    if (!tty || timer !== undefined) return;
    timer = setInterval(() => {
      frame = (frame + 1) % SPINNER.length;
      paint();
    }, SPIN_MS);
  };

  const stopSpin = (): void => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
  };

  const clearLine = (): void => {
    if (!tty || paintedWidth === 0) return;
    runtime.io.writeStderr(`\r${' '.repeat(paintedWidth)}\r`);
    paintedWidth = 0;
  };

  return {
    phase(label: string) {
      if (tty) {
        current = label;
        startSpin();
        paint();
        return;
      }
      if (label === current) return;
      current = label;
      runtime.io.writeStderr(`${label}\n`);
    },
    tick(label: string) {
      if (!tty) return;
      current = label;
      paint();
    },
    stop() {
      stopSpin();
      clearLine();
      current = '';
    },
  };
}
