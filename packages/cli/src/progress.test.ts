import { describe, expect, it } from 'vitest';
import { createProcessRuntime } from './runtime.js';
import { createStatusReporter } from './progress.js';

function capture() {
  let stderr = '';
  return {
    get stderr() {
      return stderr;
    },
    io: {
      writeStdout: () => undefined,
      writeStderr: (t: string) => {
        stderr += t;
      },
    },
  };
}

describe('createStatusReporter', () => {
  it('writes one stderr line per phase when stderr is not a TTY', () => {
    const cap = capture();
    const runtime = createProcessRuntime({
      stderrIsTTY: false,
      stdoutIsTTY: false,
      stdinIsTTY: false,
      io: cap.io,
    });
    const status = createStatusReporter(runtime);
    status.phase('Building publication');
    status.tick('Rendering pages 1/2');
    status.phase('Building publication');
    status.phase('Uploading');
    status.stop();
    expect(cap.stderr).toBe('Building publication\nUploading\n');
  });

  it('paints an in-place spinner line on a TTY and clears it on stop', () => {
    const cap = capture();
    const runtime = createProcessRuntime({
      stderrIsTTY: true,
      stdoutIsTTY: true,
      stdinIsTTY: true,
      io: cap.io,
    });
    const status = createStatusReporter(runtime);
    status.phase('Building publication');
    status.tick('Rendering pages 1/2');
    status.stop();
    expect(cap.stderr).toContain('Building publication');
    expect(cap.stderr).toContain('Rendering pages 1/2');
    expect(cap.stderr).toContain('\r');
    expect(cap.stderr.endsWith('\r')).toBe(true);
  });
});
