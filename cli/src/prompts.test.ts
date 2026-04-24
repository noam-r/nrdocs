import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { isInteractive, prompt, confirm, _setReadLine } from './prompts';

describe('isInteractive', () => {
  const originalIsTTY = process.stdin.isTTY;

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, writable: true });
  });

  it('returns true when stdin is a TTY', () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
    expect(isInteractive()).toBe(true);
  });

  it('returns false when stdin is not a TTY', () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, writable: true });
    expect(isInteractive()).toBe(false);
  });

  it('returns false when stdin.isTTY is false', () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true });
    expect(isInteractive()).toBe(false);
  });
});

describe('prompt (non-interactive)', () => {
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, writable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, writable: true });
  });

  it('returns default value in non-interactive mode', async () => {
    const result = await prompt('Enter slug', 'my-project');
    expect(result).toBe('my-project');
  });

  it('throws when no default in non-interactive mode', async () => {
    await expect(prompt('Enter slug')).rejects.toThrow(
      'Non-interactive mode: no value provided for "Enter slug" and no default available'
    );
  });
});

describe('confirm (non-interactive)', () => {
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, writable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, writable: true });
  });

  it('returns default true in non-interactive mode', async () => {
    expect(await confirm('Continue?', true)).toBe(true);
  });

  it('returns default false in non-interactive mode', async () => {
    expect(await confirm('Continue?', false)).toBe(false);
  });

  it('throws when no default in non-interactive mode', async () => {
    await expect(confirm('Continue?')).rejects.toThrow(
      'Non-interactive mode: no value provided for "Continue?" and no default available'
    );
  });
});

describe('prompt (interactive)', () => {
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, writable: true });
  });

  it('returns user input when provided', async () => {
    _setReadLine(async () => 'custom-slug');
    const result = await prompt('Enter slug', 'default-slug');
    expect(result).toBe('custom-slug');
  });

  it('returns default when user enters empty string', async () => {
    _setReadLine(async () => '');
    const result = await prompt('Enter slug', 'default-slug');
    expect(result).toBe('default-slug');
  });

  it('returns empty string when no default and user enters empty', async () => {
    _setReadLine(async () => '');
    const result = await prompt('Enter description');
    expect(result).toBe('');
  });

  it('trims whitespace from user input', async () => {
    _setReadLine(async () => '  my-slug  ');
    const result = await prompt('Enter slug');
    expect(result).toBe('my-slug');
  });

  it('includes default value hint in question text', async () => {
    let capturedQuestion = '';
    _setReadLine(async (q) => { capturedQuestion = q; return ''; });
    await prompt('Enter slug', 'my-default');
    expect(capturedQuestion).toBe('Enter slug [my-default]: ');
  });

  it('omits default hint when no default provided', async () => {
    let capturedQuestion = '';
    _setReadLine(async (q) => { capturedQuestion = q; return 'val'; });
    await prompt('Enter slug');
    expect(capturedQuestion).toBe('Enter slug: ');
  });
});

describe('confirm (interactive)', () => {
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, writable: true });
  });

  it('returns true for "y" input', async () => {
    _setReadLine(async () => 'y');
    expect(await confirm('Continue?', false)).toBe(true);
  });

  it('returns true for "yes" input', async () => {
    _setReadLine(async () => 'yes');
    expect(await confirm('Continue?', false)).toBe(true);
  });

  it('returns true for "Y" input (case-insensitive)', async () => {
    _setReadLine(async () => 'Y');
    expect(await confirm('Continue?', false)).toBe(true);
  });

  it('returns false for "n" input', async () => {
    _setReadLine(async () => 'n');
    expect(await confirm('Continue?', true)).toBe(false);
  });

  it('returns false for "no" input', async () => {
    _setReadLine(async () => 'no');
    expect(await confirm('Continue?', true)).toBe(false);
  });

  it('returns default for empty input', async () => {
    _setReadLine(async () => '');
    expect(await confirm('Continue?', true)).toBe(true);
  });

  it('returns false when no default and empty input', async () => {
    _setReadLine(async () => '');
    expect(await confirm('Continue?')).toBe(false);
  });

  it('shows Y/n hint when default is true', async () => {
    let capturedQuestion = '';
    _setReadLine(async (q) => { capturedQuestion = q; return ''; });
    await confirm('Continue?', true);
    expect(capturedQuestion).toBe('Continue? (Y/n): ');
  });

  it('shows y/N hint when default is false', async () => {
    let capturedQuestion = '';
    _setReadLine(async (q) => { capturedQuestion = q; return ''; });
    await confirm('Continue?', false);
    expect(capturedQuestion).toBe('Continue? (y/N): ');
  });

  it('shows y/n hint when no default', async () => {
    let capturedQuestion = '';
    _setReadLine(async (q) => { capturedQuestion = q; return ''; });
    await confirm('Continue?');
    expect(capturedQuestion).toBe('Continue? (y/n): ');
  });
});
