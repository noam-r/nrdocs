import type { CommandContext } from './command-context.js';
import type { Runtime } from './runtime.js';
import { requireInteractiveTerminal } from './terminal.js';
import { parseFlags } from './argv.js';
import { usageError, unavailableCommand } from './errors.js';
import { presentHumanSuccess, presentJsonSuccess } from './present.js';
import { listPublisherCredentials, removePublisherCredential } from './credentials-store.js';
import {
  listInstanceDescriptors,
  parseRequiredInstanceId,
  readActiveInstanceId,
  readInstanceDescriptor,
  writeActiveInstanceId,
} from './instance-store.js';
import { parseInstanceId } from '@nrdocs/contracts';
import { ROOT_HELP } from './help.js';

export type { CommandContext } from './command-context.js';

export async function runCredentialsCommand(
  ctx: CommandContext,
  args: readonly string[],
): Promise<void> {
  const sub = args[0];
  if (ctx.help || sub === undefined || sub === 'help') {
    presentHumanSuccess(
      ctx.runtime,
      'nrdocs credentials list\nnrdocs credentials remove <site-id>\n',
    );
    return;
  }
  if (sub === 'list') {
    const { positionals } = parseFlags(args.slice(1));
    if (positionals.length > 0) throw usageError('credentials list takes no arguments.');
    const rows = await listPublisherCredentials(ctx.runtime);
    if (ctx.json) {
      presentJsonSuccess(
        ctx.runtime,
        rows.map((r) => ({
          site_id: r.site_id,
          server: r.server,
          status: 'stored',
        })),
      );
      return;
    }
    if (rows.length === 0) {
      presentHumanSuccess(ctx.runtime, 'No local publisher credentials.');
      return;
    }
    const lines = ['Local publisher credentials:', ''];
    for (const row of rows) {
      lines.push(`  ${row.site_id}`);
      lines.push(`    server: ${row.server}`);
      lines.push(`    status: stored`);
    }
    presentHumanSuccess(ctx.runtime, lines.join('\n'));
    return;
  }
  if (sub === 'remove') {
    if (ctx.json) throw usageError('credentials remove does not support --json.');
    const siteId = args[1];
    if (!siteId) throw usageError('credentials remove requires a site ID.');
    if (args.length > 2) throw usageError('credentials remove takes exactly one site ID.');
    const result = await removePublisherCredential(ctx.runtime, siteId);
    if (!result.removed) {
      presentHumanSuccess(
        ctx.runtime,
        `No local credential file existed for:\n  ${result.site_id}`,
      );
      return;
    }
    presentHumanSuccess(
      ctx.runtime,
      `Removed local publisher credential for:\n  ${result.site_id}\n\nThis did not revoke any server-side token.`,
    );
    return;
  }
  throw usageError(`Unknown credentials command: ${sub}`, 'Run: nrdocs credentials --help');
}

export async function runInstanceCommand(
  ctx: CommandContext,
  args: readonly string[],
): Promise<void> {
  const sub = args[0];
  if (ctx.help || sub === undefined || sub === 'help') {
    presentHumanSuccess(
      ctx.runtime,
      'nrdocs instance list\nnrdocs instance show [instance-id]\nnrdocs instance use <instance-id>\n',
    );
    return;
  }
  if (sub === 'list') {
    const { positionals } = parseFlags(args.slice(1));
    if (positionals.length > 0) throw usageError('instance list takes no arguments.');
    const active = await readActiveInstanceId(ctx.runtime);
    const rows = await listInstanceDescriptors(ctx.runtime);
    if (ctx.json) {
      presentJsonSuccess(
        ctx.runtime,
        rows.map((d) => ({
          instance_id: d.instance_id,
          display_name: d.display_name,
          canonical_origin: d.canonical_origin,
          status: d.status,
          active: d.instance_id === active,
        })),
      );
      return;
    }
    if (rows.length === 0) {
      presentHumanSuccess(ctx.runtime, 'No local administrative instances.');
      return;
    }
    const lines = ['Administrative instances:', ''];
    for (const d of rows) {
      const marker = d.instance_id === active ? ' (active)' : '';
      lines.push(`  ${d.display_name}${marker}`);
      lines.push(`    id:     ${d.instance_id}`);
      lines.push(`    origin: ${d.canonical_origin}`);
      lines.push(`    status: ${d.status}`);
    }
    presentHumanSuccess(ctx.runtime, lines.join('\n'));
    return;
  }
  if (sub === 'show') {
    const idArg = args[1];
    if (args.length > 2) throw usageError('instance show takes at most one instance ID.');
    const id = idArg ? parseInstanceId(idArg) : await readActiveInstanceId(ctx.runtime);
    if (idArg && !id) throw usageError('instance show requires a valid opaque instance ID.');
    if (!id) {
      throw usageError(
        'No active administrative instance is selected.',
        'Run: nrdocs instance use <instance-id>',
      );
    }
    const d = await readInstanceDescriptor(ctx.runtime, id);
    const active = await readActiveInstanceId(ctx.runtime);
    if (ctx.json) {
      presentJsonSuccess(ctx.runtime, {
        ...d,
        active: d.instance_id === active,
      });
      return;
    }
    presentHumanSuccess(
      ctx.runtime,
      [
        `Instance: ${d.display_name}`,
        `ID:       ${d.instance_id}`,
        `Origin:   ${d.canonical_origin}`,
        `Status:   ${d.status}`,
        `Version:  ${d.deployed_version}`,
        `Active:   ${d.instance_id === active ? 'yes' : 'no'}`,
      ].join('\n'),
    );
    return;
  }
  if (sub === 'use') {
    if (ctx.json) throw usageError('instance use does not support --json.');
    requireInteractiveTerminal(ctx.runtime, 'nrdocs instance use');
    const id = parseRequiredInstanceId(args[1]);
    if (args.length > 2) throw usageError('instance use takes exactly one instance ID.');
    await writeActiveInstanceId(ctx.runtime, id);
    const d = await readInstanceDescriptor(ctx.runtime, id);
    presentHumanSuccess(
      ctx.runtime,
      `Active instance set to:\n  ${d.display_name}\n  ${d.instance_id}`,
    );
    return;
  }
  throw usageError(`Unknown instance command: ${sub}`, 'Run: nrdocs instance --help');
}

export async function runStubCommand(commandPath: string, ctx: CommandContext): Promise<void> {
  if (ctx.help) {
    presentHumanSuccess(ctx.runtime, `Usage: nrdocs ${commandPath}\n`);
    return;
  }
  const mutatingAdmin = new Set([
    'deploy',
    'site create',
    'site access',
    'site password change',
    'site enable',
    'site disable',
    'site rename',
    'site delete',
    'token issue',
    'token revoke',
  ]);
  if (mutatingAdmin.has(commandPath)) {
    requireInteractiveTerminal(ctx.runtime, `nrdocs ${commandPath}`);
  }
  throw unavailableCommand(`nrdocs ${commandPath}`);
}

export function rootHelp(runtime: Runtime): void {
  presentHumanSuccess(runtime, ROOT_HELP);
}
