import { parse } from 'yaml';
import { marked } from 'marked';
import type { PageFrontmatter } from '../types.js';

/** A heading extracted from the rendered Markdown for the TOC. */
export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

/** A fully parsed Markdown page with frontmatter, rendered HTML, TOC, and source path. */
export interface ParsedPage {
  frontmatter: PageFrontmatter;
  html: string;
  toc: TocEntry[];
  sourcePath: string;
}

/**
 * Try to extract YAML frontmatter from the content.
 * If the content starts with `---\n`, parse the frontmatter block.
 * Otherwise return an empty object and treat the entire content as body.
 */
function extractFrontmatter(content: string): { raw: Record<string, unknown>; body: string } {
  if (!content.startsWith('---\n')) {
    return { raw: {}, body: content };
  }

  const closingIndex = content.indexOf('\n---\n', 4);
  if (closingIndex === -1) {
    // Unclosed frontmatter block — treat as no frontmatter
    return { raw: {}, body: content };
  }

  const yamlBlock = content.slice(4, closingIndex);
  const body = content.slice(closingIndex + 5);

  const parsed = parse(yamlBlock);
  if (parsed == null || typeof parsed !== 'object') {
    return { raw: {}, body: content };
  }

  return { raw: parsed as Record<string, unknown>, body };
}

/**
 * Validate and extract frontmatter fields. All fields are optional.
 * Invalid types are reported as errors; missing fields are simply absent.
 */
function validateFrontmatter(raw: Record<string, unknown>, sourcePath: string): PageFrontmatter {
  const fm: PageFrontmatter = {};

  if (raw.title !== undefined) {
    if (typeof raw.title !== 'string' || raw.title.trim() === '') {
      throw new Error(`${sourcePath}: frontmatter "title" must be a non-empty string`);
    }
    fm.title = raw.title;
  }

  if (raw.order !== undefined) {
    if (typeof raw.order !== 'number' || !Number.isFinite(raw.order)) {
      throw new Error(`${sourcePath}: frontmatter "order" must be a number`);
    }
    fm.order = raw.order;
  }

  if (raw.section !== undefined) {
    if (typeof raw.section !== 'string') {
      throw new Error(`${sourcePath}: frontmatter "section" must be a string`);
    }
    fm.section = raw.section;
  }

  if (raw.hidden !== undefined) {
    if (typeof raw.hidden !== 'boolean') {
      throw new Error(`${sourcePath}: frontmatter "hidden" must be a boolean`);
    }
    fm.hidden = raw.hidden;
  }

  if (raw.template !== undefined) {
    if (typeof raw.template !== 'string') {
      throw new Error(`${sourcePath}: frontmatter "template" must be a string`);
    }
    fm.template = raw.template;
  }

  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || !raw.tags.every((t: unknown) => typeof t === 'string')) {
      throw new Error(`${sourcePath}: frontmatter "tags" must be an array of strings`);
    }
    fm.tags = raw.tags as string[];
  }

  return fm;
}

/**
 * Slugify a heading string for use as an HTML id attribute.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Strip HTML tags from a string to get plain text.
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * Parse a Markdown page. Frontmatter is optional — if absent, the entire
 * content is treated as Markdown body and all metadata comes from nav.yml.
 *
 * h2/h3 headings get `id` attributes injected for the in-page TOC.
 */
export function parseMarkdownPage(content: string, sourcePath: string): ParsedPage {
  const { raw, body } = extractFrontmatter(content);
  const frontmatter = validateFrontmatter(raw, sourcePath);

  const toc: TocEntry[] = [];
  const usedIds = new Set<string>();

  const renderer = new marked.Renderer();
  renderer.heading = function ({ text, depth }: { text: string; depth: number }): string {
    if (depth === 2 || depth === 3) {
      const plainText = stripHtml(text);
      let id = slugify(plainText);

      if (usedIds.has(id)) {
        let counter = 1;
        while (usedIds.has(`${id}-${counter}`)) counter++;
        id = `${id}-${counter}`;
      }
      usedIds.add(id);

      toc.push({ id, text: plainText, level: depth as 2 | 3 });
      return `<h${depth} id="${id}">${text}</h${depth}>\n`;
    }
    return `<h${depth}>${text}</h${depth}>\n`;
  };

  const html = marked.parse(body, { async: false, renderer }) as string;

  return { frontmatter, html, toc, sourcePath };
}
