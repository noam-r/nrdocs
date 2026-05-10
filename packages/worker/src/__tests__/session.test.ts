import { describe, it, expect } from 'vitest';
import {
  createSessionCookie,
  validateSessionCookie,
  getSessionCookie,
  buildSetCookieHeader,
} from '../session.js';
import type { SessionData } from '../session.js';

const TEST_SECRET = 'test-secret-key-for-hmac-signing';

describe('createSessionCookie / validateSessionCookie', () => {
  it('creates and validates a session cookie', async () => {
    const data: SessionData = {
      repo_id: 'repo_abc123',
      password_version: 1,
      expires_at: Date.now() + 86400000, // 24h from now
    };

    const cookie = await createSessionCookie(data, TEST_SECRET);
    expect(cookie).toContain('.');
    expect(cookie.split('.').length).toBe(2);

    const result = await validateSessionCookie(cookie, TEST_SECRET);
    expect(result).not.toBeNull();
    expect(result!.repo_id).toBe('repo_abc123');
    expect(result!.password_version).toBe(1);
    expect(result!.expires_at).toBe(data.expires_at);
  });

  it('rejects expired sessions', async () => {
    const data: SessionData = {
      repo_id: 'repo_abc123',
      password_version: 1,
      expires_at: Date.now() - 1000, // expired 1 second ago
    };

    const cookie = await createSessionCookie(data, TEST_SECRET);
    const result = await validateSessionCookie(cookie, TEST_SECRET);
    expect(result).toBeNull();
  });

  it('rejects tampered cookies (modified payload)', async () => {
    const data: SessionData = {
      repo_id: 'repo_abc123',
      password_version: 1,
      expires_at: Date.now() + 86400000,
    };

    const cookie = await createSessionCookie(data, TEST_SECRET);
    const [_payload, signature] = cookie.split('.');

    // Create a different payload
    const tamperedData: SessionData = {
      repo_id: 'repo_hacked',
      password_version: 1,
      expires_at: Date.now() + 86400000,
    };
    const tamperedPayload = btoa(JSON.stringify(tamperedData))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const tamperedCookie = `${tamperedPayload}.${signature}`;
    const result = await validateSessionCookie(tamperedCookie, TEST_SECRET);
    expect(result).toBeNull();
  });

  it('rejects tampered cookies (modified signature)', async () => {
    const data: SessionData = {
      repo_id: 'repo_abc123',
      password_version: 1,
      expires_at: Date.now() + 86400000,
    };

    const cookie = await createSessionCookie(data, TEST_SECRET);
    const [payload] = cookie.split('.');

    const tamperedCookie = `${payload}.tampered_signature`;
    const result = await validateSessionCookie(tamperedCookie, TEST_SECRET);
    expect(result).toBeNull();
  });

  it('rejects cookies signed with a different secret', async () => {
    const data: SessionData = {
      repo_id: 'repo_abc123',
      password_version: 1,
      expires_at: Date.now() + 86400000,
    };

    const cookie = await createSessionCookie(data, 'secret-one');
    const result = await validateSessionCookie(cookie, 'secret-two');
    expect(result).toBeNull();
  });

  it('rejects empty or malformed cookies', async () => {
    expect(await validateSessionCookie('', TEST_SECRET)).toBeNull();
    expect(await validateSessionCookie('no-dot-here', TEST_SECRET)).toBeNull();
    expect(await validateSessionCookie('.', TEST_SECRET)).toBeNull();
    expect(await validateSessionCookie('abc.', TEST_SECRET)).toBeNull();
    expect(await validateSessionCookie('.abc', TEST_SECRET)).toBeNull();
  });

  it('rejects cookies with invalid JSON payload', async () => {
    // Create a cookie with invalid JSON as payload
    const invalidPayload = btoa('not-json')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const result = await validateSessionCookie(`${invalidPayload}.fakesig`, TEST_SECRET);
    expect(result).toBeNull();
  });
});

describe('getSessionCookie', () => {
  it('extracts the session cookie for a repo path', () => {
    const request = new Request('http://localhost/acme/docs/', {
      headers: {
        Cookie: '__nrdocs_session_acme_docs=cookie_value; other=stuff',
      },
    });

    const result = getSessionCookie(request, '/acme/docs');
    expect(result).toBe('cookie_value');
  });

  it('returns null when no cookie header exists', () => {
    const request = new Request('http://localhost/acme/docs/');
    const result = getSessionCookie(request, '/acme/docs');
    expect(result).toBeNull();
  });

  it('returns null when the specific cookie is not present', () => {
    const request = new Request('http://localhost/acme/docs/', {
      headers: {
        Cookie: '__nrdocs_session_other_repo=value',
      },
    });

    const result = getSessionCookie(request, '/acme/docs');
    expect(result).toBeNull();
  });

  it('handles cookie values with dots (session format)', () => {
    const request = new Request('http://localhost/acme/docs/', {
      headers: {
        Cookie: '__nrdocs_session_acme_docs=payload.signature',
      },
    });

    const result = getSessionCookie(request, '/acme/docs');
    expect(result).toBe('payload.signature');
  });

  it('handles leading/trailing slashes in repo path', () => {
    const request = new Request('http://localhost/acme/docs/', {
      headers: {
        Cookie: '__nrdocs_session_acme_docs=value',
      },
    });

    const result = getSessionCookie(request, '/acme/docs/');
    expect(result).toBe('value');
  });
});

describe('buildSetCookieHeader', () => {
  it('builds a proper Set-Cookie header', () => {
    const header = buildSetCookieHeader('cookie_value', '/acme/docs', 86400);
    expect(header).toContain('__nrdocs_session_acme_docs=cookie_value');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/acme/docs/');
    expect(header).toContain('Max-Age=86400');
  });

  it('ensures path ends with trailing slash', () => {
    const header = buildSetCookieHeader('val', '/owner/repo', 3600);
    expect(header).toContain('Path=/owner/repo/');
  });

  it('does not double trailing slash', () => {
    const header = buildSetCookieHeader('val', '/owner/repo/', 3600);
    expect(header).toContain('Path=/owner/repo/');
    expect(header).not.toContain('Path=/owner/repo//');
  });
});
