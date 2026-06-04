import { describe, it, expect } from 'vitest';
import { validatePath, validateExtension } from '../archive.js';

describe('validatePath', () => {
  it('accepts valid relative paths', () => {
    expect(validatePath('index.html')).toBeNull();
    expect(validatePath('docs/api/index.html')).toBeNull();
    expect(validatePath('assets/style.css')).toBeNull();
    expect(validatePath('nrdocs-manifest.json')).toBeNull();
  });

  it('rejects empty paths', () => {
    const result = validatePath('');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('INVALID_PATH');
  });

  it('rejects paths with null bytes', () => {
    const result = validatePath('file\0.html');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('INVALID_PATH');
  });

  it('rejects absolute paths', () => {
    const result = validatePath('/etc/passwd');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('PATH_TRAVERSAL');
  });

  it('rejects paths with backslashes', () => {
    const result = validatePath('docs\\file.html');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('PATH_TRAVERSAL');
  });

  it('rejects paths with ..', () => {
    expect(validatePath('../secret.html')!.code).toBe('PATH_TRAVERSAL');
    expect(validatePath('docs/../../../etc/passwd')!.code).toBe('PATH_TRAVERSAL');
    expect(validatePath('docs/..hidden/file.html')!.code).toBe('PATH_TRAVERSAL');
  });
});

describe('validateExtension', () => {
  it('accepts allowed extensions', () => {
    expect(validateExtension('index.html')).toBeNull();
    expect(validateExtension('style.css')).toBeNull();
    expect(validateExtension('data.json')).toBeNull();
    expect(validateExtension('logo.svg')).toBeNull();
    expect(validateExtension('image.png')).toBeNull();
    expect(validateExtension('photo.jpg')).toBeNull();
    expect(validateExtension('photo.jpeg')).toBeNull();
    expect(validateExtension('anim.gif')).toBeNull();
    expect(validateExtension('image.webp')).toBeNull();
    expect(validateExtension('favicon.ico')).toBeNull();
    expect(validateExtension('readme.txt')).toBeNull();
    expect(validateExtension('doc.pdf')).toBeNull();
  });

  it('accepts nrdocs-manifest.json regardless of extension rules', () => {
    expect(validateExtension('nrdocs-manifest.json')).toBeNull();
    expect(validateExtension('subdir/nrdocs-manifest.json')).toBeNull();
  });

  it('rejects JavaScript extensions', () => {
    const jsResult = validateExtension('script.js');
    expect(jsResult).not.toBeNull();
    expect(jsResult!.code).toBe('REJECTED_EXTENSION');

    const mjsResult = validateExtension('module.mjs');
    expect(mjsResult).not.toBeNull();
    expect(mjsResult!.code).toBe('REJECTED_EXTENSION');

    const cjsResult = validateExtension('common.cjs');
    expect(cjsResult).not.toBeNull();
    expect(cjsResult!.code).toBe('REJECTED_EXTENSION');
  });

  it('rejects unknown extensions', () => {
    const result = validateExtension('file.exe');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('EXTENSION_NOT_PERMITTED');
  });

  it('rejects files without extensions', () => {
    const result = validateExtension('Makefile');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('INVALID_EXTENSION');
  });

  it('handles nested paths correctly', () => {
    expect(validateExtension('docs/api/index.html')).toBeNull();
    expect(validateExtension('assets/js/app.js')!.code).toBe('REJECTED_EXTENSION');
  });

  it('is case-insensitive for extensions', () => {
    expect(validateExtension('FILE.HTML')).toBeNull();
    expect(validateExtension('STYLE.CSS')).toBeNull();
    expect(validateExtension('SCRIPT.JS')!.code).toBe('REJECTED_EXTENSION');
  });
});
