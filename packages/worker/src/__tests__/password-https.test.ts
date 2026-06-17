import { describe, it, expect } from 'vitest';
import {
  renderHttpsRequiredPage,
  renderPasswordPage,
} from '../handlers/password-page.js';

describe('password HTTPS pages', () => {
  it('https required page explains HTTP limitation and links to HTTPS', async () => {
    const response = renderHttpsRequiredPage(
      'https://docs.example.com/acme/docs/',
      'acme/docs',
    );
    const html = await response.text();
    expect(html).toContain('Secure connection required');
    expect(html).toContain('only works over');
    expect(html).toContain('Continue with HTTPS');
    expect(html).toContain('https://docs.example.com/acme/docs/');
    expect(html).not.toContain('type="password"');
  });

  it('password page includes secure hint when provided', async () => {
    const response = renderPasswordPage('acme/docs', undefined, {
      secureHint: 'Use an https:// link to this site.',
    });
    const html = await response.text();
    expect(html).toContain('type="password"');
    expect(html).toContain('Use an https:// link to this site.');
  });
});
