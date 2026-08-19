import type {
  Blockquote,
  Code,
  Content,
  Delete,
  Emphasis,
  Heading,
  Image,
  InlineCode,
  Link,
  List,
  ListItem,
  Paragraph,
  Root,
  Strong,
  Table,
  TableCell,
  TableRow,
  Text,
} from 'mdast';
import { normalizeHighlightLanguage } from './highlight.js';
import { headingPlainTextFromChildren } from './markdown-fragments.js';
import { RendererError } from './types.js';

export type MarkdownLinkResolver = {
  resolvePageHref(href: string): string | null;
  resolveAssetHref(href: string): string | null;
  resolveAttachmentHref(href: string): string | null;
  rewriteFragment?(fragment: string): string;
};

function fenceMarker(code: string): string {
  let n = 3;
  const runs = code.match(/`+/g);
  if (runs) {
    const longest = Math.max(...runs.map((r) => r.length));
    if (longest >= n) n = longest + 1;
  }
  return '`'.repeat(n);
}

function escapeText(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, '\\$1');
}

function escapeLinkText(value: string): string {
  return value.replace(/([\\[\]])/g, '\\$1');
}

function escapeUrl(url: string): string {
  if (/[\s()<>]/.test(url) || url.includes(' ')) return `<${url.replace(/[<>]/g, '')}>`;
  return url.replace(/[()]/g, (ch) => encodeURIComponent(ch));
}

function escapeTitle(title: string): string {
  return title.replace(/"/g, '\\"');
}

function codeSpan(value: string): string {
  let n = 1;
  const runs = value.match(/`+/g);
  if (runs) n = Math.max(...runs.map((r) => r.length)) + 1;
  const ticks = '`'.repeat(n);
  const pad = value.startsWith('`') || value.endsWith('`') || value.startsWith(' ') ? ' ' : '';
  return `${ticks}${pad}${value}${pad}${ticks}`;
}

function isExternalHref(href: string): boolean {
  try {
    const abs = new URL(href);
    return abs.protocol === 'http:' || abs.protocol === 'https:' || abs.protocol === 'mailto:';
  } catch {
    return false;
  }
}

export function serializeArticleMarkdown(
  tree: Root,
  sourceFile: string,
  links: MarkdownLinkResolver,
): string {
  const renderInlines = (nodes: Content[]): string => nodes.map((n) => renderInline(n)).join('');

  const renderInline = (node: Content): string => {
    switch (node.type) {
      case 'text':
        return escapeText((node as Text).value);
      case 'break':
        return '\\\n';
      case 'strong':
        return `**${renderInlines((node as Strong).children as Content[])}**`;
      case 'emphasis':
        return `*${renderInlines((node as Emphasis).children as Content[])}*`;
      case 'delete':
        return `~~${renderInlines((node as Delete).children as Content[])}~~`;
      case 'inlineCode':
        return codeSpan((node as InlineCode).value);
      case 'link':
        return renderLink(node as Link);
      case 'image':
        return renderImage(node as Image);
      case 'html':
        throw new RendererError(
          'unsupported_markdown',
          `Raw HTML is not supported:\n  ${sourceFile}`,
          { sourceFile },
        );
      default:
        if ('children' in node && Array.isArray((node as { children?: Content[] }).children)) {
          return renderInlines((node as { children: Content[] }).children);
        }
        throw new RendererError(
          'unsupported_markdown',
          `Unsupported Markdown construct (${node.type}):\n  ${sourceFile}`,
          { sourceFile },
        );
    }
  };

  const renderLink = (link: Link): string => {
    const href = link.url ?? '';
    const children = renderInlines(link.children as Content[]);
    const title = link.title ? ` "${escapeTitle(link.title)}"` : '';
    const label = children.length ? children : escapeLinkText(href);

    if (href.startsWith('#')) {
      const frag = links.rewriteFragment ? links.rewriteFragment(href.slice(1)) : href.slice(1);
      return `[${label}](#${frag}${title})`;
    }
    if (isExternalHref(href)) {
      return `[${label}](${escapeUrl(href)}${title})`;
    }

    const pageHref = links.resolvePageHref(href);
    if (pageHref !== null) return `[${label}](${escapeUrl(pageHref)}${title})`;
    const assetHref = links.resolveAssetHref(href);
    if (assetHref !== null) return `[${label}](${escapeUrl(assetHref)}${title})`;
    const attachHref = links.resolveAttachmentHref(href);
    if (attachHref !== null) return `[${label}](${escapeUrl(attachHref)}${title})`;
    return label;
  };

  const renderImage = (image: Image): string => {
    const src = image.url ?? '';
    const alt = escapeLinkText(image.alt ?? '');
    const title = image.title ? ` "${escapeTitle(image.title)}"` : '';
    const assetHref = links.resolveAssetHref(src);
    if (assetHref === null) {
      throw new RendererError(
        'broken_link',
        `Unable to resolve image:\n  ${src}\nfrom:\n  ${sourceFile}`,
        { sourceFile },
      );
    }
    return `![${alt}](${escapeUrl(assetHref)}${title})`;
  };

  const renderListItem = (
    item: ListItem,
    ordered: boolean,
    index: number,
    start: number,
  ): string => {
    const checked = item.checked;
    let marker: string;
    if (checked === true) marker = '- [x] ';
    else if (checked === false) marker = '- [ ] ';
    else if (ordered) marker = `${start + index}. `;
    else marker = '- ';

    const inner = (item.children as Content[]).map((c, i) => {
      const block = renderBlock(c).replace(/\n$/, '');
      if (i === 0) return block;
      return block
        .split('\n')
        .map((line) => (line.length ? `  ${line}` : ''))
        .join('\n');
    });
    const body = inner.join('\n\n');
    const lines = body.split('\n');
    return `${marker}${lines[0] ?? ''}${lines
      .slice(1)
      .map((l) => `\n  ${l}`)
      .join('')}`;
  };

  const renderTable = (table: Table): string => {
    const rows = table.children as TableRow[];
    if (rows.length === 0) return '';
    const align = table.align ?? [];
    const cellText = (cell: TableCell): string =>
      renderInlines(cell.children as Content[]).replace(/\|/g, '\\|');
    const renderRow = (row: TableRow): string => {
      const cells = (row.children as TableCell[]).map(cellText);
      return `| ${cells.join(' | ')} |`;
    };
    const delim = `| ${(rows[0]!.children as TableCell[])
      .map((_, i) => {
        const a = align[i];
        if (a === 'left') return ':---';
        if (a === 'right') return '---:';
        if (a === 'center') return ':---:';
        return '---';
      })
      .join(' | ')} |`;
    return [renderRow(rows[0]!), delim, ...rows.slice(1).map(renderRow)].join('\n');
  };

  const renderBlock = (node: Content): string => {
    switch (node.type) {
      case 'paragraph':
        return `${renderInlines((node as Paragraph).children)}\n`;
      case 'heading': {
        const h = node as Heading;
        const text = renderInlines(h.children as Content[]);
        return `${'#'.repeat(h.depth)} ${text}\n`;
      }
      case 'thematicBreak':
        return '---\n';
      case 'blockquote': {
        const inner = renderBlocks((node as Blockquote).children as Content[])
          .replace(/\n$/, '')
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n');
        return `${inner}\n`;
      }
      case 'list': {
        const list = node as List;
        const start = list.ordered && list.start != null && list.start !== 1 ? list.start : 1;
        const items = (list.children as ListItem[]).map((item, i) =>
          renderListItem(item, Boolean(list.ordered), i, start),
        );
        return `${items.join('\n')}\n`;
      }
      case 'code': {
        const code = node as Code;
        const langRaw = (code.lang ?? '').trim();
        const lang =
          langRaw.toLowerCase() === 'mermaid' ? 'mermaid' : normalizeHighlightLanguage(code.lang);
        const fence = fenceMarker(code.value);
        const info =
          lang && lang !== 'plaintext'
            ? lang
            : langRaw.toLowerCase() === 'mermaid'
              ? 'mermaid'
              : '';
        return `${fence}${info}\n${code.value}\n${fence}\n`;
      }
      case 'table':
        return `${renderTable(node as Table)}\n`;
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
        if ('children' in node && Array.isArray((node as { children?: Content[] }).children)) {
          return renderBlocks((node as { children: Content[] }).children);
        }
        throw new RendererError(
          'unsupported_markdown',
          `Unsupported Markdown construct (${node.type}):\n  ${sourceFile}`,
          { sourceFile },
        );
    }
  };

  const renderBlocks = (nodes: Content[]): string => {
    const parts: string[] = [];
    for (const n of nodes) {
      const s = renderBlock(n).replace(/\n+$/, '');
      if (s.length) parts.push(s);
    }
    return parts.length ? `${parts.join('\n\n')}\n` : '';
  };

  let body = renderBlocks(tree.children as Content[]);
  body = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!body.endsWith('\n')) body += '\n';
  if (body === '\n' || body.length === 0) body = '\n';
  void headingPlainTextFromChildren;
  return body;
}
