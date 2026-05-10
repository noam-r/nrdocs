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

/**
 * Renders Markdown content to HTML.
 */
export function renderMarkdown(content: string): string {
  return md.render(content);
}
