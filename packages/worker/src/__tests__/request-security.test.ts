import { describe, it, expect } from 'vitest';
import {
  isSecureRequest,
  buildHttpsRequestUrl,
  buildHttpsRepoUrl,
} from '../request-security.js';

describe('isSecureRequest', () => {
  it('returns true for https:// URLs', () => {
    const request = new Request('https://docs.example.com/acme/docs/');
    expect(isSecureRequest(request)).toBe(true);
  });

  it('returns false for http:// URLs without forwarded proto', () => {
    const request = new Request('http://docs.example.com/acme/docs/');
    expect(isSecureRequest(request)).toBe(false);
  });

  it('returns true for http:// URL when X-Forwarded-Proto is https', () => {
    const request = new Request('http://docs.example.com/acme/docs/', {
      headers: { 'X-Forwarded-Proto': 'https' },
    });
    expect(isSecureRequest(request)).toBe(true);
  });
});

describe('buildHttpsRequestUrl', () => {
  it('upgrades protocol while preserving path and query', () => {
    const request = new Request('http://docs.example.com/acme/docs/page?q=1');
    expect(buildHttpsRequestUrl(request)).toBe('https://docs.example.com/acme/docs/page?q=1');
  });
});

describe('buildHttpsRepoUrl', () => {
  it('builds repo root over https', () => {
    const request = new Request('http://docs.example.com/SolisPlatform/solis_sdk/page');
    expect(buildHttpsRepoUrl(request, 'solisplatform/solis_sdk')).toBe(
      'https://docs.example.com/solisplatform/solis_sdk/',
    );
  });
});
