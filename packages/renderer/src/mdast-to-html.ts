import { createHash } from 'node:crypto';
import type {
  Content,
  Root,
  Heading,
  Paragraph,
  List,
  ListItem,
  Link,
  Image,
  Code,
  InlineCode,
  Emphasis,
  Strong,
  Delete,
  Blockquote,
  Table,
  TableRow,
  TableCell,
  Text,
} from 'mdast';
import { highlightCode } from './highlight.js';
import { escapeAttr, escapeHtml } from './escape.js';
import { RendererError } from './types.js';

export type LinkResolver = {
  resolvePageHref(href: string): string | null;
  resolveAssetHref(href: string): string | null;
  resolveAttachmentHref(href: string): string | null;
};

const MAX_MERMAID_BLOCKS = 50;
const MAX_MERMAID_BYTES = 64 * 1024;

function headingId(index: number, text: string): string {
  const hex = createHash('sha256').update(`${index}:${text}`).digest('hex').slice(0, 16);
  return `nr-h-${hex}`;
}

function textContent(nodes: Content[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') out += n.value;
    else if ('children' in n && Array.isArray((n as { children?: Content[] }).children)) {
      out += textContent((n as { children: Content[] }).children);
    }
  }
  return out;
}

export function renderArticleHtml(
  tree: Root,
  sourceFile: string,
  links: LinkResolver,
): { html: string; mermaidCount: number } {
  let mermaidCount = 0;
  let headingIndex = 0;

  const renderNodes = (nodes: Content[]): string => nodes.map((n) => renderNode(n)).join('');

  const renderNode = (node: Content): string => {
    switch (node.type) {
      case 'paragraph':
        return `<p>${renderNodes((node as Paragraph).children)}</p>\n`;
      case 'heading': {
        const h = node as Heading;
        const text = textContent(h.children as Content[]);
        const id = headingId(headingIndex++, text);
        return `<h${h.depth} id="${id}">${renderNodes(h.children as Content[])}</h${h.depth}>\n`;
      }
      case 'text':
        return escapeHtml((node as Text).value);
      case 'break':
        return '<br>\n';
      case 'strong':
        return `<strong>${renderNodes((node as Strong).children as Content[])}</strong>`;
      case 'emphasis':
        return `<em>${renderNodes((node as Emphasis).children as Content[])}</em>`;
      case 'delete':
        return `<del>${renderNodes((node as Delete).children as Content[])}</del>`;
      case 'inlineCode':
        return `<code>${escapeHtml((node as InlineCode).value)}</code>`;
      case 'thematicBreak':
        return '<hr>\n';
      case 'blockquote':
        return `<blockquote>\n${renderNodes((node as Blockquote).children as Content[])}</blockquote>\n`;
      case 'list': {
        const list = node as List;
        const tag = list.ordered ? 'ol' : 'ul';
        const start =
          list.ordered && list.start != null && list.start !== 1
            ? ` start="${Math.max(-100000, Math.min(100000, list.start))}"`
            : '';
        return `<${tag}${start}>\n${(list.children as ListItem[]).map(renderListItem).join('')}</${tag}>\n`;
      }
      case 'code': {
        const code = node as Code;
        const lang = (code.lang ?? '').trim();
        if (lang.toLowerCase() === 'mermaid') {
          mermaidCount++;
          if (mermaidCount > MAX_MERMAID_BLOCKS) {
            throw new RendererError(
              'mermaid_limit',
              `Page exceeds ${MAX_MERMAID_BLOCKS} Mermaid blocks:\n  ${sourceFile}`,
              { sourceFile },
            );
          }
          const bytes = Buffer.byteLength(code.value, 'utf8');
          if (bytes > MAX_MERMAID_BYTES) {
            throw new RendererError(
              'mermaid_limit',
              `Mermaid block exceeds 64 KiB:\n  ${sourceFile}`,
              { sourceFile },
            );
          }
          return `<pre class="nr-mermaid" data-nr-mermaid><code>${escapeHtml(code.value)}</code></pre>\n`;
        }
        const { language, innerHtml } = highlightCode(code.value, code.lang);
        return `<pre><code class="language-${escapeAttr(language)}">${innerHtml}</code></pre>\n`;
      }
      case 'link': {
        const link = node as Link;
        return renderLink(link);
      }
      case 'image': {
        const image = node as Image;
        return renderImage(image);
      }
      case 'table':
        return renderTable(node as Table);
      case 'html':
        throw new RendererError(
          'unsupported_markdown',
          `Raw HTML is not supported:\n  ${sourceFile}`,
          { sourceFile },
        );
      case 'footnoteDefinition':
      case 'footnoteReference':
        throw new RendererError(
          'unsupported_markdown',
          `Footnotes are not supported:\n  ${sourceFile}`,
          { sourceFile },
        );
      default:
        // mdast GFM task list checkboxes appear as listItem checked
        if (
          (node as { type: string }).type === 'yaml' ||
          (node as { type: string }).type === 'toml'
        ) {
          throw new RendererError(
            'unsupported_markdown',
            `Frontmatter is not supported:\n  ${sourceFile}`,
            { sourceFile },
          );
        }
        // Soft breaks are 'break' already; unknown nodes rejected
        if ('children' in node && Array.isArray((node as { children?: Content[] }).children)) {
          return renderNodes((node as { children: Content[] }).children);
        }
        throw new RendererError(
          'unsupported_markdown',
          `Unsupported Markdown construct (${node.type}):\n  ${sourceFile}`,
          { sourceFile },
        );
    }
  };

  const renderListItem = (item: ListItem): string => {
    const checked = item.checked;
    let body = renderNodes(item.children as Content[]);
    if (checked === true || checked === false) {
      const box = `<input type="checkbox" disabled${checked ? ' checked' : ''}> `;
      // Prefer injecting into first paragraph
      if (body.startsWith('<p>')) {
        body = `<p>${box}${body.slice(3)}`;
      } else {
        body = `${box}${body}`;
      }
    }
    return `<li>${body}</li>\n`;
  };

  const renderLink = (link: Link): string => {
    const href = link.url ?? '';
    const title = link.title ? ` title="${escapeAttr(link.title)}"` : '';
    const children = renderNodes(link.children as Content[]);

    if (href.startsWith('#')) {
      return `<a href="${escapeAttr(href)}"${title}>${children}</a>`;
    }

    try {
      const abs = new URL(href);
      if (abs.protocol === 'http:' || abs.protocol === 'https:' || abs.protocol === 'mailto:') {
        return `<a href="${escapeAttr(href)}"${title}>${children}</a>`;
      }
      throw new RendererError('unsupported_link', `Unsupported link scheme:\n  ${href}`, {
        sourceFile,
      });
    } catch (error) {
      if (error instanceof RendererError) throw error;
    }

    const pageHref = links.resolvePageHref(href);
    if (pageHref !== null) {
      return `<a href="${escapeAttr(pageHref)}"${title}>${children}</a>`;
    }
    const assetHref = links.resolveAssetHref(href);
    if (assetHref !== null) {
      return `<a href="${escapeAttr(assetHref)}"${title}>${children}</a>`;
    }
    const attachHref = links.resolveAttachmentHref(href);
    if (attachHref !== null) {
      return `<a href="${escapeAttr(attachHref)}"${title}>${children}</a>`;
    }
    const label = children.trim() ? children : escapeHtml(href);
    return `<span class="nr-broken-link" title="${escapeAttr(`Broken link: ${href}`)}">${label}</span>`;
  };

  const renderImage = (image: Image): string => {
    const src = image.url ?? '';
    const alt = escapeAttr(image.alt ?? '');
    const title = image.title ? ` title="${escapeAttr(image.title)}"` : '';
    const assetHref = links.resolveAssetHref(src);
    if (assetHref === null) {
      throw new RendererError(
        'broken_link',
        `Unable to resolve image:\n  ${src}\nfrom:\n  ${sourceFile}`,
        { sourceFile },
      );
    }
    return `<img src="${escapeAttr(assetHref)}" alt="${alt}"${title} loading="lazy" decoding="async">`;
  };

  const renderTable = (table: Table): string => {
    const rows = table.children as TableRow[];
    if (rows.length === 0) return '<table></table>\n';
    const align = table.align ?? [];
    const head = rows[0]!;
    const body = rows.slice(1);
    const cellClass = (i: number): string => {
      const a = align[i];
      if (a === 'left') return ' class="nr-align-left"';
      if (a === 'center') return ' class="nr-align-center"';
      if (a === 'right') return ' class="nr-align-right"';
      return '';
    };
    const renderRow = (row: TableRow, tag: 'th' | 'td'): string => {
      const cells = (row.children as TableCell[])
        .map((c, i) => `<${tag}${cellClass(i)}>${renderNodes(c.children as Content[])}</${tag}>`)
        .join('');
      return `<tr>${cells}</tr>\n`;
    };
    return `<table>\n<thead>\n${renderRow(head, 'th')}</thead>\n<tbody>\n${body.map((r) => renderRow(r, 'td')).join('')}</tbody>\n</table>\n`;
  };

  const html = renderNodes(tree.children as Content[]);
  return { html, mermaidCount };
}
