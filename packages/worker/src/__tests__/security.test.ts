/**
 * Security regression tests.
 * Verifies path traversal, extension filtering, route squatting,
 * token comparison, password hashing, and session cookies.
 */

import { describe, it, expect } from 'vitest';
import { validatePath, validateExtension } from '../archive.js';
import { isReservedPath, resolveServingPath } from '../path-resolver.js';
import { timingSafeEqual } from '../auth.js';
import { hashPassword, verifyPassword } from '../crypto.js';
import {
  createSessionCookie,
  validateSessionCookie,
  buildSetCookieHeader,
} from '../session.js';
import type { SessionData } from '../session.js';

describe('Path traversal prevention', () => {
  it('rejects ../secret', () => {
    const err = validatePath('../secret');
    expect(err).not.toBeNull();
    expect(err!.code).toBe('PATH_TRAVERSAL');
  });

  it('rejects ../../etc/passwd', () => {
    const err = validatePath('../../etc/passwd');
    expect(err).not.toBeNull();
    expect(err!.code).toBe('PATH_TRAVERSAL');
  });

  it('rejects /absolute/path', () => {
    const err = validatePath('/absolute/path');
    expect(err).not.toBeNull();
    expect(err!.code).toBe('PATH_TRAVERSAL');
  });

  it('rejects C:\\windows\\system32', () => {
    const err = validatePath('C:\\windows\\system32');
    expect(err).not.toBeNull();
    expect(err!.code).toBe('PATH_TRAVERSAL');
  });

  it('rejects nested/../../../escape', () => {
    const err = validatePath('nested/../../../escape');
    expect(err).not.toBeNull();
    expect(err!.code).toBe('PATH_TRAVERSAL');
  });

  it('rejects paths with null bytes', () => {
    const err = validatePath('file\0.html');
    expect(err).not.toBeNull();
    expect(err!.code).toBe('INVALID_PATH');
  });

  it('rejects paths with backslashes', () => {
    const err = validatePath('dir\\file.html');
    expect(err).not.toBeNull();
    expect(err!.code).toBe('PATH_TRAVERSAL');
  });

  it('accepts valid relative paths', () => {
    expect(validatePath('index.html')).toBeNull();
    expect(validatePath('sub/page.html')).toBeNull();
    expect(validatePath('deep/nested/file.css')).toBeNull();
  });

  it('rejects empty paths', () => {
    const err = validatePath('');
    expect(err).not.toBeNull();
    expect(err!.code).toBe('INVALID_PATH');
  });
});

describe('Extension filtering', () => {
  it('rejects .js files', () => {
    const err = validateExtension('script.js');
    expect(err).not.toBeNull();
    expect(err!.code).toBe('REJECTED_EXTENSION');
  });

  it('allows platform runtime .js under _nrdocs/', () => {
    expect(validateExtension('_nrdocs/mermaid.min.js')).toBeNull();
  });

  it('rejects .mjs files', () => {
    const err = validateExtension('module.mjs');
    expect(err).not.toBeNull();
    expect(err!.code).toBe('REJECTED_EXTENSION');
  });

  it('rejects .cjs files', () => {
    const err = validateExtension('common.cjs');
    expect(err).not.toBeNull();
    expect(err!.code).toBe('REJECTED_EXTENSION');
  });

  it('rejects .exe files (unknown extension)', () => {
    const err = validateExtension('program.exe');
    expect(err).not.toBeNull();
    expect(err!.code).toBe('INVALID_EXTENSION');
  });

  it('rejects .sh files (unknown extension)', () => {
    const err = validateExtension('script.sh');
    expect(err).not.toBeNull();
    expect(err!.code).toBe('INVALID_EXTENSION');
  });

  it('rejects .py files (unknown extension)', () => {
    const err = validateExtension('app.py');
    expect(err).not.toBeNull();
    expect(err!.code).toBe('INVALID_EXTENSION');
  });

  it('rejects files without extensions', () => {
    const err = validateExtension('Makefile');
    expect(err).not.toBeNull();
    expect(err!.code).toBe('INVALID_EXTENSION');
  });

  it('accepts allowed extensions', () => {
    expect(validateExtension('page.html')).toBeNull();
    expect(validateExtension('style.css')).toBeNull();
    expect(validateExtension('data.json')).toBeNull();
    expect(validateExtension('logo.svg')).toBeNull();
    expect(validateExtension('photo.png')).toBeNull();
    expect(validateExtension('image.jpg')).toBeNull();
    expect(validateExtension('pic.jpeg')).toBeNull();
    expect(validateExtension('anim.gif')).toBeNull();
    expect(validateExtension('modern.webp')).toBeNull();
    expect(validateExtension('icon.ico')).toBeNull();
    expect(validateExtension('readme.txt')).toBeNull();
    expect(validateExtension('doc.pdf')).toBeNull();
  });

  it('allows nrdocs-manifest.json regardless of extension rules', () => {
    expect(validateExtension('nrdocs-manifest.json')).toBeNull();
  });
});

describe('Route squatting prevention', () => {
  it('blocks /api/anything', () => {
    expect(isReservedPath('/api/repos')).toBe(true);
    expect(isReservedPath('/api/status')).toBe(true);
    expect(isReservedPath('/api/anything')).toBe(true);
  });

  it('blocks /api (exact)', () => {
    expect(isReservedPath('/api')).toBe(true);
  });

  it('blocks /_nrdocs/anything', () => {
    expect(isReservedPath('/_nrdocs/login')).toBe(true);
    expect(isReservedPath('/_nrdocs/anything')).toBe(true);
  });

  it('blocks /_nrdocs (exact)', () => {
    expect(isReservedPath('/_nrdocs')).toBe(true);
  });

  it('blocks /favicon.ico', () => {
    expect(isReservedPath('/favicon.ico')).toBe(true);
  });

  it('blocks /robots.txt', () => {
    expect(isReservedPath('/robots.txt')).toBe(true);
  });

  it('blocks /.well-known/anything', () => {
    expect(isReservedPath('/.well-known/security.txt')).toBe(true);
    expect(isReservedPath('/.well-known/openid-configuration')).toBe(true);
  });

  it('does not block normal repo paths', () => {
    expect(isReservedPath('/acme/docs')).toBe(false);
    expect(isReservedPath('/acme/docs/')).toBe(false);
    expect(isReservedPath('/org/repo/page/')).toBe(false);
  });
});

describe('Canonical redirects for approved repos', () => {
  it('resolveServingPath produces redirect for bare repo path', () => {
    const result = resolveServingPath('/acme/docs', 'acme', 'docs');
    expect(result.type).toBe('redirect');
    if (result.type === 'redirect') {
      expect(result.location).toBe('/acme/docs/');
    }
  });

  it('resolveServingPath serves index.html for trailing slash', () => {
    const result = resolveServingPath('/acme/docs/', 'acme', 'docs');
    expect(result.type).toBe('serve');
    if (result.type === 'serve') {
      expect(result.filePath).toBe('index.html');
    }
  });

  it('resolveServingPath redirects .html to clean URL', () => {
    const result = resolveServingPath('/acme/docs/page.html', 'acme', 'docs');
    expect(result.type).toBe('redirect');
    if (result.type === 'redirect') {
      expect(result.location).toBe('/acme/docs/page/');
    }
  });

  it('resolveServingPath serves assets directly without redirect', () => {
    const result = resolveServingPath('/acme/docs/style.css', 'acme', 'docs');
    expect(result.type).toBe('serve');
    if (result.type === 'serve') {
      expect(result.filePath).toBe('style.css');
    }
  });

  it('resolveServingPath redirects non-asset paths to add trailing slash', () => {
    const result = resolveServingPath('/acme/docs/guide', 'acme', 'docs');
    expect(result.type).toBe('redirect');
    if (result.type === 'redirect') {
      expect(result.location).toBe('/acme/docs/guide/');
    }
  });
});

describe('Token comparison (timingSafeEqual)', () => {
  it('returns true for matching strings', () => {
    expect(timingSafeEqual('hello', 'hello')).toBe(true);
    expect(timingSafeEqual('secret-token-123', 'secret-token-123')).toBe(true);
  });

  it('returns false for non-matching strings', () => {
    expect(timingSafeEqual('hello', 'world')).toBe(false);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
  });

  it('returns false for different-length strings', () => {
    expect(timingSafeEqual('short', 'longer-string')).toBe(false);
    expect(timingSafeEqual('a', 'ab')).toBe(false);
    expect(timingSafeEqual('', 'notempty')).toBe(false);
  });

  it('returns true for empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

describe('Password hashing', () => {
  it('produces different salts each time', async () => {
    const result1 = await hashPassword('password123');
    const result2 = await hashPassword('password123');
    expect(result1.salt).not.toBe(result2.salt);
  });

  it('verifyPassword succeeds with correct password', async () => {
    const { hash, salt, iteration_count } = await hashPassword('mypassword');
    const valid = await verifyPassword('mypassword', hash, salt, iteration_count);
    expect(valid).toBe(true);
  });

  it('verifyPassword fails with wrong password', async () => {
    const { hash, salt, iteration_count } = await hashPassword('correct');
    const valid = await verifyPassword('wrong', hash, salt, iteration_count);
    expect(valid).toBe(false);
  });

  it('hash output is hex-encoded', async () => {
    const { hash, salt } = await hashPassword('test');
    // Hex strings only contain 0-9 and a-f
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(salt).toMatch(/^[0-9a-f]+$/);
    // SHA-256 produces 32 bytes = 64 hex chars
    expect(hash.length).toBe(64);
    // 16 bytes salt = 32 hex chars
    expect(salt.length).toBe(32);
  });

  it('uses configurable iteration count', async () => {
    const result = await hashPassword('test', 1000);
    expect(result.iteration_count).toBe(1000);
  });
});

describe('Session cookies', () => {
  const SECRET = 'test-session-secret';

  it('expired sessions are rejected', async () => {
    const data: SessionData = {
      repo_id: 'repo_1',
      password_version: 1,
      expires_at: Date.now() - 60_000, // expired 1 minute ago
    };
    const cookie = await createSessionCookie(data, SECRET);
    const result = await validateSessionCookie(cookie, SECRET);
    expect(result).toBeNull();
  });

  it('tampered cookies are rejected', async () => {
    const data: SessionData = {
      repo_id: 'repo_1',
      password_version: 1,
      expires_at: Date.now() + 86400_000,
    };
    const cookie = await createSessionCookie(data, SECRET);
    // Tamper with the payload portion
    const tampered = 'x' + cookie.slice(1);
    const result = await validateSessionCookie(tampered, SECRET);
    expect(result).toBeNull();
  });

  it('different secrets produce different signatures', async () => {
    const data: SessionData = {
      repo_id: 'repo_1',
      password_version: 1,
      expires_at: Date.now() + 86400_000,
    };
    const cookie1 = await createSessionCookie(data, 'secret-a');
    const cookie2 = await createSessionCookie(data, 'secret-b');

    // Signatures should differ
    const sig1 = cookie1.split('.')[1];
    const sig2 = cookie2.split('.')[1];
    expect(sig1).not.toBe(sig2);

    // Cross-validation should fail
    const result = await validateSessionCookie(cookie1, 'secret-b');
    expect(result).toBeNull();
  });

  it('cookie is path-scoped correctly', () => {
    const header = buildSetCookieHeader('value', '/acme/docs', 3600);
    expect(header).toContain('Path=/acme/docs/');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
  });

  it('valid sessions are accepted', async () => {
    const data: SessionData = {
      repo_id: 'repo_1',
      password_version: 2,
      expires_at: Date.now() + 86400_000,
    };
    const cookie = await createSessionCookie(data, SECRET);
    const result = await validateSessionCookie(cookie, SECRET);
    expect(result).not.toBeNull();
    expect(result!.repo_id).toBe('repo_1');
    expect(result!.password_version).toBe(2);
  });
});
