import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { visit } from 'unist-util-visit';
import type { Root, Heading, Content } from 'mdast';
import {
  isAttachmentExtension,
  isForbiddenWebExtension,
  isImageExtension,
  mediaTypeForExtension,
  normalizeExtension,
} from '@nrdocs/contracts';
import { decodeMarkdownSource } from './utf8.js';
import { RendererError, errorLoc } from './types.js';
import { joinPosix, toPosix } from './paths.js';

export type ScannedLink = {
  kind: 'page' | 'image' | 'attachment' | 'external' | 'fragment';
  href: string;
  line?: number;
  column?: number;
};

function parseMarkdown(text: string, sourceFile: string): Root {
  // Reject frontmatter delimiters at the beginning of a page
  if (/^(---|\+\+\+)\r?\n/.test(text)) {
    throw new RendererError(
      'unsupported_markdown',
      `Frontmatter is not supported:\n  ${sourceFile}`,
      { sourceFile, line: 1, column: 1 },
    );
  }

  let tree: Root;
  try {
    tree = fromMarkdown(text, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    });
  } catch {
    throw new RendererError('markdown_parse', `Failed to parse Markdown:\n  ${sourceFile}`, {
      sourceFile,
    });
  }

  visit(tree, (node) => {
    if (node.type === 'html') {
      throw new RendererError(
        'unsupported_markdown',
        `Raw HTML is not supported:\n  ${sourceFile}`,
        errorLoc(sourceFile, node.position?.start.line, node.position?.start.column),
      );
    }
  });

  // Lightweight rejection of footnote / math constructs that GFM doesn't consume
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\[\^[^\]]+\]:/.test(line) || /\[\^[^\]]+\]/.test(line)) {
      throw new RendererError(
        'unsupported_markdown',
        `Footnotes are not supported:\n  ${sourceFile}`,
        { sourceFile, line: i + 1 },
      );
    }
  }

  return tree;
}

function textFromNodes(nodes: Content[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') out += n.value;
    else if ('children' in n && Array.isArray(n.children)) {
      out += textFromNodes(n.children as Content[]);
    }
  }
  return out;
}

export function extractFirstH1(text: string, sourceFile: string): string | null {
  const tree = parseMarkdown(text, sourceFile);
  let found: string | null = null;
  visit(tree, 'heading', (node: Heading) => {
    if (found !== null) return;
    if (node.depth === 1) {
      const t = textFromNodes(node.children as Content[]).trim();
      if (t) found = t;
    }
  });
  return found;
}

export function loadAndNormalizeMarkdown(
  bytes: Uint8Array,
  sourceFile: string,
): { text: string; tree: Root } {
  const text = decodeMarkdownSource(bytes, sourceFile);
  const tree = parseMarkdown(text, sourceFile);
  return { text, tree };
}

export function collectLinks(tree: Root): ScannedLink[] {
  const links: ScannedLink[] = [];

  visit(tree, (node) => {
    if (node.type !== 'link' && node.type !== 'image') return;
    const href = node.url ?? '';
    const line = node.position?.start.line;
    const column = node.position?.start.column;
    const loc = {
      href,
      ...(line !== undefined ? { line } : {}),
      ...(column !== undefined ? { column } : {}),
    };

    if (!href || href.startsWith('#')) {
      links.push({ kind: 'fragment', ...loc });
      return;
    }

    let url: URL | null = null;
    try {
      url = new URL(href);
    } catch {
      url = null;
    }

    if (
      url &&
      (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:')
    ) {
      links.push({ kind: 'external', ...loc });
      return;
    }
    if (url && url.protocol !== '') {
      // other schemes
      links.push({ kind: 'external', ...loc });
      return;
    }

    // Relative / root-relative local ref
    const pathPart = href.split('#')[0]!.split('?')[0]!;
    const ext = normalizeExtension(pathPart);
    if (node.type === 'image') {
      links.push({ kind: 'image', ...loc });
      return;
    }
    if (ext === '.md' || pathPart.endsWith('.md')) {
      links.push({ kind: 'page', ...loc });
      return;
    }
    if (ext && isImageExtension(ext)) {
      links.push({ kind: 'image', ...loc });
      return;
    }
    if (ext && isAttachmentExtension(ext)) {
      links.push({ kind: 'attachment', ...loc });
      return;
    }
    if (ext && isForbiddenWebExtension(ext)) {
      links.push({ kind: 'attachment', ...loc }); // classified later as forbidden
      return;
    }
    // Unknown relative — treat as attachment-like for error reporting
    links.push({ kind: 'attachment', ...loc });
  });

  return links;
}

export function resolveRelativeHref(fromSourceFile: string, href: string): string {
  const pathPart = href.split('#')[0]!.split('?')[0]!;
  const fromDir = toPosix(fromSourceFile).includes('/')
    ? toPosix(fromSourceFile).slice(0, toPosix(fromSourceFile).lastIndexOf('/'))
    : '';
  if (pathPart.startsWith('/')) {
    return pathPart.slice(1);
  }
  const combined = joinPosix(fromDir, pathPart);
  const parts = combined.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (out.length === 0) {
        throw new RendererError('path_escape', `Link escapes the publication root:\n  ${href}`, {
          sourceFile: fromSourceFile,
        });
      }
      out.pop();
      continue;
    }
    out.push(p);
  }
  return out.join('/');
}

export {
  mediaTypeForExtension,
  normalizeExtension,
  isImageExtension,
  isAttachmentExtension,
  isForbiddenWebExtension,
};
