/**
 * Default production backends for deploy and site/token administration.
 */
import { createD1HttpExecutor, type SqlExecutor, type SqlRow } from '@nrdocs/persistence';
import type { InstanceDescriptor } from '@nrdocs/contracts';
import type { Runtime } from '../runtime.js';
import { resolveCloudflareCredential, type RunCommand } from './auth.js';
import type { DeployOptions } from '../deploy.js';
import type { AdminOptions } from '../admin/context.js';
import {
  createLiveCloudflareControlPlane,
  createR2ArtifactStoreFromControlPlane,
} from './live-cloudflare.js';
import type { CloudflareControlPlane } from './cloudflare.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function createDefaultRunCommand(): RunCommand {
  return (command, args, options) =>
    new Promise((resolve) => {
      const child = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env as NodeJS.ProcessEnv,
        shell: false,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (error) => {
        resolve({ code: 1, stdout, stderr: stderr || String(error) });
      });
      child.on('close', (code) => {
        resolve({ code: code ?? 1, stdout, stderr });
      });
    });
}

async function resolveToken(runtime: Runtime): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-cf-'));
  try {
    const cred = await resolveCloudflareCredential(runtime, createDefaultRunCommand(), tempDir);
    return cred.token;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function createDefaultDeployOptions(runtime: Runtime): Promise<DeployOptions> {
  const token = await resolveToken(runtime);
  return {
    cloudflare: createLiveCloudflareControlPlane({ token }),
    runCommand: createDefaultRunCommand(),
    mkdtemp: async () => fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-deploy-')),
    rmTemp: async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

export function createAdminD1Executor(
  cf: CloudflareControlPlane,
  descriptor: InstanceDescriptor,
): SqlExecutor {
  if (!descriptor.database_id) {
    throw new Error('Instance database_id is missing; complete deploy first.');
  }
  return createD1HttpExecutor({
    async query(sql, params = []) {
      const result = await cf.d1Query(descriptor.account_id, descriptor.database_id!, sql, params);
      return {
        results: result.results as SqlRow[],
        meta: { changes: result.meta.changes },
      };
    },
  });
}

export async function createDefaultAdminOptions(runtime: Runtime): Promise<AdminOptions> {
  const token = await resolveToken(runtime);
  const cf = createLiveCloudflareControlPlane({ token });
  return {
    openDb: async (descriptor: InstanceDescriptor) => createAdminD1Executor(cf, descriptor),
    openStore: async (descriptor: InstanceDescriptor) =>
      createR2ArtifactStoreFromControlPlane(cf, descriptor.account_id, descriptor.bucket_name),
  };
}
