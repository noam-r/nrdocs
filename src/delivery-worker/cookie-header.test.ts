import { describe, expect, it } from 'vitest';
import { readCookieValue } from './cookie-header';

describe('readCookieValue', () => {
  it('returns value when cookie value contains = (e.g. base64 padding)', () => {
    const h = 'a=1; nrdocs_session=eyJ.x==; b=2';
    expect(readCookieValue(h, 'nrdocs_session')).toBe('eyJ.x==');
  });

  it('strips RFC double quotes around value', () => {
    const h = 'nrdocs_session="eyJ.abc.def"';
    expect(readCookieValue(h, 'nrdocs_session')).toBe('eyJ.abc.def');
  });

  it('percent-decodes when % is present', () => {
    const h = 'nrdocs_session=eyJ%2Eabc'; // encoded dot
    expect(readCookieValue(h, 'nrdocs_session')).toBe('eyJ.abc');
  });
});
