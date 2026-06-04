/**
 * Markdown rendering with markdown-it.
 * Configured with html: false (escapes raw HTML) and GFM tables enabled.
 */
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,        // Disable raw HTML — escapes it
  linkify: false,     // Don't auto-linkify URLs
  typographer: false, // No smart quotes or typographic replacements
});

const defaultFence = md.renderer.rules.fence!;

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  const lang = token.info.trim().split(/\s+/g)[0];
  if (lang === 'mermaid') {
    const escaped = md.utils.escapeHtml(token.content.trim());
    return `<pre class="mermaid">${escaped}</pre>\n`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

/** Matches ```mermaid fenced code blocks. */
const MERMAID_FENCE_RE = /^```mermaid\s*$/m;

/**
 * Returns true if markdown contains at least one mermaid code fence.
 */
export function contentHasMermaid(content: string): boolean {
  return MERMAID_FENCE_RE.test(content);
}

/**
 * Renders Markdown content to HTML.
 */
export function renderMarkdown(content: string): string {
  return md.render(content);
}
