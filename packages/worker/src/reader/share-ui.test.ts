import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import vm from 'node:vm';
import { PLATFORM_CSS, PLATFORM_CSS_V2, PLATFORM_JS, PLATFORM_JS_V2 } from './platform-assets.js';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('v2 share dialog', () => {
  it('keeps v1 platform CSS and JS byte-identical at their v1 exports', () => {
    expect(PLATFORM_CSS.startsWith('/* nrdocs platform reader.css v1 */')).toBe(true);
    expect(PLATFORM_JS.startsWith('/* nrdocs platform reader.js v1 */')).toBe(true);
    expect(PLATFORM_CSS_V2).toContain('.nr-ai-share.nr-icon-btn');
    expect(PLATFORM_CSS_V2).toContain('.nr-ai-btn-primary');
    expect(PLATFORM_JS_V2).toContain('Copy a prompt for an AI');
    expect(PLATFORM_JS_V2).toContain('None of the sentences here are copied');
    expect(PLATFORM_JS_V2).toContain('Copy AI prompt');
    expect(PLATFORM_JS).not.toContain('Copy a prompt for an AI');
    expect(PLATFORM_CSS).toContain('/_nrdocs/v1/logo.svg');
    expect(PLATFORM_JS).toContain('/_nrdocs/v1/mermaid.js');
    expect(PLATFORM_CSS_V2).toContain('/_nrdocs/v2/logo.svg');
    expect(PLATFORM_CSS_V2).not.toContain('/_nrdocs/v1/logo.svg');
    expect(PLATFORM_JS_V2).toContain('/_nrdocs/v2/mermaid.js');
    expect(PLATFORM_JS_V2).not.toContain('/_nrdocs/v1/mermaid.js');
  });

  it('falls back to a textarea when clipboard write is denied after a protected mint', async () => {
    const { window, document } = parseHTML(
      `<!doctype html><html><body>
        <header class="nr-header">
          <button class="nr-ai-share nr-icon-btn" type="button" aria-label="Copy a prompt for an AI">Copy a prompt for an AI</button>
          <button class="nr-theme-toggle" type="button">Theme</button>
        </header>
      </body></html>`,
    );
    const origCreate = document.createElement.bind(document);
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      const el = origCreate(tag, options);
      if (tag.toLowerCase() === 'dialog') {
        Object.assign(el, {
          showModal() {
            el.setAttribute('open', '');
          },
          close() {
            el.removeAttribute('open');
            el.dispatchEvent(new window.Event('close'));
          },
        });
      }
      return el;
    }) as typeof document.createElement;

    let posted = false;
    const instructions = 'Use this entry URL as the starting document.\nhttps://example.test/grant';
    const fetches: Array<{ url: string; method: string }> = [];
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      fetches.push({ url, method });
      if (method === 'GET') {
        return new Response(
          JSON.stringify({
            access_mode: 'password',
            csrf: 'csrf-token',
            allowed_durations: ['1h', '24h', '7d'],
            default_duration: '24h',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      posted = true;
      const body = JSON.parse(String(init?.body ?? '{}')) as { csrf?: string; duration?: string };
      expect(body.csrf).toBe('csrf-token');
      expect(body.duration).toBe('24h');
      return new Response(
        JSON.stringify({ instructions, entry_url: 'https://example.test/grant' }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    };

    const matchMedia = () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true });
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
      configurable: true,
    });
    Object.defineProperty(window, 'location', {
      value: { pathname: '/handbook/' },
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
      configurable: true,
    });
    window.fetch = fetchImpl as typeof fetch;

    const context = vm.createContext({
      document,
      window,
      location: window.location,
      navigator: window.navigator,
      fetch: fetchImpl,
      HTMLButtonElement: window.HTMLButtonElement,
      HTMLDialogElement: window.HTMLDialogElement,
      localStorage: window.localStorage,
      matchMedia,
      console,
      setTimeout,
      clearTimeout,
      Event: window.Event,
    });

    vm.runInContext(PLATFORM_JS_V2, context);
    const button = document.querySelector('.nr-ai-share') as HTMLButtonElement;
    button.click();
    await tick();
    await tick();
    const copy = document.querySelector('.nr-ai-copy') as HTMLButtonElement | null;
    expect(copy).not.toBeNull();
    copy!.click();
    await tick();
    await tick();
    expect(posted).toBe(true);
    const area = document.querySelector('textarea.nr-ai-fallback') as HTMLTextAreaElement | null;
    expect(area).not.toBeNull();
    expect(area!.value).toBe(instructions);
    expect(area!.value).not.toContain('Copy a prompt for an AI');
    expect(document.querySelector('.nr-ai-dialog')?.textContent).toContain(
      'None of the sentences here are copied',
    );
    expect(document.querySelector('.nr-ai-copy')?.className).toContain('nr-ai-btn-primary');
    expect(fetches.some((f) => f.method === 'POST')).toBe(true);

    const cancel = document.querySelector('.nr-ai-cancel') as HTMLButtonElement;
    cancel.click();
    await tick();
    expect(document.querySelector('textarea.nr-ai-fallback')).toBeNull();
    expect(document.querySelector('dialog')).toBeNull();
  });
});
