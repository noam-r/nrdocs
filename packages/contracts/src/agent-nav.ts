import { canonicalizeJson, type CanonicalJson } from './canonical-json.js';
import { sha256Hex } from './digest.js';
import { AGENT_ID_HEX_LENGTH, AGENT_NAV_MAX_DEPTH } from './agent-limits.js';
import { isAgentHexId } from './agent-ids.js';

export type AgentNavigationNode =
  | {
      kind: 'section';
      id: string;
      title: string;
      children: AgentNavigationNode[];
    }
  | {
      kind: 'page';
      page_id: string;
      children: AgentNavigationNode[];
    };

export async function agentSectionId(
  title: string,
  childIndexPath: readonly number[],
): Promise<string> {
  const nfcTitle = title.normalize('NFC');
  const descriptor: CanonicalJson = {
    path: childIndexPath.map((n) => n),
    title: nfcTitle,
  };
  const hex = await sha256Hex(canonicalizeJsonBytesSafe(descriptor));
  return `section_${hex.slice(0, AGENT_ID_HEX_LENGTH)}`;
}

function canonicalizeJsonBytesSafe(value: CanonicalJson): Uint8Array {
  return new TextEncoder().encode(canonicalizeJson(value));
}

export function isAgentSectionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    new RegExp(`^section_[0-9a-f]{${AGENT_ID_HEX_LENGTH}}$`).test(value)
  );
}

export function flattenAgentNavigationPageIds(nodes: readonly AgentNavigationNode[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly AgentNavigationNode[]) => {
    for (const n of list) {
      if (n.kind === 'page') out.push(n.page_id);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export async function assertAgentNavigation(
  nodes: readonly AgentNavigationNode[],
  pageIdsInOrder: readonly string[],
): Promise<void> {
  const sectionIds = new Set<string>();
  const pageSeen = new Set<string>();

  const walk = async (
    list: readonly AgentNavigationNode[],
    depth: number,
    path: number[],
  ): Promise<void> => {
    if (depth > AGENT_NAV_MAX_DEPTH) throw new Error('navigation depth exceeds 8');
    for (let i = 0; i < list.length; i++) {
      const node = list[i]!;
      const childPath = [...path, i];
      if (node.kind === 'section') {
        if (!isAgentSectionId(node.id)) throw new Error('invalid section id');
        if (typeof node.title !== 'string' || node.title.length === 0) {
          throw new Error('section title required');
        }
        const expected = await agentSectionId(node.title, childPath);
        if (node.id !== expected) throw new Error('section id mismatch');
        if (sectionIds.has(node.id)) throw new Error('duplicate section id');
        sectionIds.add(node.id);
        if (!Array.isArray(node.children)) throw new Error('section children required');
        await walk(node.children, depth + 1, childPath);
      } else if (node.kind === 'page') {
        if (!isAgentHexId(node.page_id)) throw new Error('invalid navigation page_id');
        if (pageSeen.has(node.page_id)) throw new Error('duplicate navigation page');
        pageSeen.add(node.page_id);
        if (!Array.isArray(node.children)) throw new Error('page children required');
        await walk(node.children, depth + 1, childPath);
      } else {
        throw new Error('invalid navigation node kind');
      }
    }
  };

  await walk(nodes, 1, []);
  const flattened = flattenAgentNavigationPageIds(nodes);
  if (flattened.length !== pageIdsInOrder.length) {
    throw new Error('navigation flatten order mismatch');
  }
  for (let i = 0; i < flattened.length; i++) {
    if (flattened[i] !== pageIdsInOrder[i]) throw new Error('navigation flatten order mismatch');
  }
  for (const id of flattened) {
    if (!pageIdsInOrder.includes(id)) throw new Error('navigation references unknown page');
  }
}
