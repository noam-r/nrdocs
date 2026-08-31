import {
  AGENT_ALL_MD_MAX_BYTES,
  agentSectionId,
  computeAgentContentDigest,
  serializeAgentManifestBytes,
  type AgentManifestV1,
  type AgentNavigationNode,
} from '@nrdocs/contracts';
import type { PublicationNavNode } from './types.js';

function escapeMd(text: string): string {
  return text.replace(/([\\*`])/g, '\\$1');
}

export async function buildAgentNavigation(
  nodes: PublicationNavNode[],
  pageIdByRoute: Map<string, string>,
  path: number[] = [],
): Promise<AgentNavigationNode[]> {
  const out: AgentNavigationNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const childPath = [...path, i];
    if (node.kind === 'section-heading') {
      out.push({
        kind: 'section',
        id: await agentSectionId(node.title, childPath),
        title: node.title.normalize('NFC'),
        children: await buildAgentNavigation(node.children, pageIdByRoute, childPath),
      });
    } else {
      const pageId = node.route ? pageIdByRoute.get(node.route) : undefined;
      if (!pageId) continue;
      out.push({
        kind: 'page',
        page_id: pageId,
        children: await buildAgentNavigation(node.children, pageIdByRoute, childPath),
      });
    }
  }
  return out;
}

function renderIndexNav(nodes: AgentNavigationNode[], pageTitleById: Map<string, string>): string {
  const walk = (list: AgentNavigationNode[], indent: string): string[] => {
    const lines: string[] = [];
    for (const n of list) {
      if (n.kind === 'section') {
        lines.push(`${indent}- ${escapeMd(n.title)}`);
        lines.push(...walk(n.children, `${indent}  `));
      } else {
        const title = pageTitleById.get(n.page_id) ?? n.page_id;
        lines.push(`${indent}- [${escapeMd(title)}](pages/${n.page_id}.md)`);
        lines.push(...walk(n.children, `${indent}  `));
      }
    }
    return lines;
  };
  return walk(nodes, '').join('\n');
}

export function buildAgentIndexMarkdown(input: {
  siteTitle: string;
  language: string;
  direction: string;
  rootRoute: string;
  hasAll: boolean;
  navigation: AgentNavigationNode[];
  pageTitleById: Map<string, string>;
}): string {
  const allLine = input.hasAll
    ? 'Read [all.md](all.md) when available; otherwise read the listed pages in order.'
    : 'Read the listed pages in order.';
  const nav = renderIndexNav(input.navigation, input.pageTitleById);
  const body = [
    `# ${escapeMd(input.siteTitle)}`,
    '',
    'This is the machine-readable representation of the current nrdocs publication.',
    '',
    `Language: \`${input.language}\`  `,
    `Direction: \`${input.direction}\`  `,
    `Human site root: \`${input.rootRoute}\``,
    '',
    allLine,
    '',
    'Structured metadata: [manifest.json](manifest.json)',
    '',
    '## Pages',
    '',
    nav,
    '',
    'The publication may be replaced while it is being read. Use the manifest content digest to detect change.',
    '',
  ].join('\n');
  return body.endsWith('\n') ? body : `${body}\n`;
}

export function buildAgentAllMarkdown(input: {
  siteTitle: string;
  pages: Array<{ title: string; humanRoute: string; pageId: string; markdown: string }>;
  maxBytes?: number;
}): Uint8Array | null {
  const parts: string[] = [
    `# ${escapeMd(input.siteTitle)}`,
    '',
    '> Complete machine-readable nrdocs publication. Documents follow navigation order.',
    '',
  ];
  for (const page of input.pages) {
    const content = page.markdown.replace(/\n+$/, '');
    parts.push(
      '---',
      '',
      `Document title: **${escapeMd(page.title)}**  `,
      `Human route: \`${page.humanRoute}\`  `,
      `Page ID: \`${page.pageId}\``,
      '',
      '---',
      '',
      content,
      '',
    );
  }
  const text = `${parts.join('\n').replace(/\n+$/, '')}\n`;
  const bytes = new TextEncoder().encode(text);
  const maxBytes = input.maxBytes ?? AGENT_ALL_MD_MAX_BYTES;
  if (bytes.byteLength > maxBytes) return null;
  return bytes;
}

export async function sealAgentManifestFile(input: {
  siteTitle: string;
  language: string;
  direction: 'ltr' | 'rtl' | 'auto';
  rootRoute: string;
  pages: AgentManifestV1['pages'];
  assets: AgentManifestV1['assets'];
  attachments: AgentManifestV1['attachments'];
  navigation: AgentNavigationNode[];
  indexSha256: string;
  allSha256: string | null;
  hasAll: boolean;
  allSize: number | null;
}): Promise<{ manifest: AgentManifestV1; bytes: Uint8Array }> {
  const content_digest = await computeAgentContentDigest({
    site: {
      title: input.siteTitle,
      language: input.language,
      direction: input.direction,
      root_route: input.rootRoute,
    },
    pages: input.pages,
    index_sha256: input.indexSha256,
    all_sha256: input.allSha256,
    assets: input.assets,
    attachments: input.attachments,
  });
  const manifest: AgentManifestV1 = {
    schema_version: 1,
    site: {
      title: input.siteTitle,
      language: input.language,
      direction: input.direction,
      root_route: input.rootRoute,
    },
    publication: {
      content_digest,
      page_count: input.pages.length,
      has_all_markdown: input.hasAll,
      all_markdown_size: input.allSize,
    },
    pages: input.pages,
    assets: input.assets,
    attachments: input.attachments,
    navigation: input.navigation,
  };
  return { manifest, bytes: serializeAgentManifestBytes(manifest) };
}
