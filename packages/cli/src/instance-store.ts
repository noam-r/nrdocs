import {
  parseActiveInstancePointer,
  parseInstanceDescriptor,
  parseInstanceId,
  type InstanceDescriptor,
  type InstanceId,
} from '@nrdocs/contracts';
import type { Runtime } from './runtime.js';
import { activeInstancePath, instancePath, instancesDir, nrdocsHome } from './runtime.js';
import { assertRegularNonSymlinkFile, atomicWriteFile, ensurePrivateDir } from './fs-safe.js';
import { credentialError, ioError, usageError } from './errors.js';

export async function ensureInstanceStore(runtime: Runtime): Promise<void> {
  await ensurePrivateDir(runtime, nrdocsHome(runtime));
  await ensurePrivateDir(runtime, instancesDir(runtime));
}

export async function writeInstanceDescriptor(
  runtime: Runtime,
  descriptor: InstanceDescriptor,
): Promise<string> {
  await ensureInstanceStore(runtime);
  const filePath = instancePath(runtime, descriptor.instance_id);
  const body = `${JSON.stringify(descriptor, null, 2)}\n`;
  await atomicWriteFile(runtime, filePath, body, 0o600);
  return filePath;
}

export async function readInstanceDescriptor(
  runtime: Runtime,
  instanceId: InstanceId,
): Promise<InstanceDescriptor> {
  const filePath = instancePath(runtime, instanceId);
  try {
    await assertRegularNonSymlinkFile(runtime, filePath, 'instance descriptor');
  } catch (error) {
    if (error instanceof Error && /was not found/.test(error.message)) {
      throw credentialError(`No local instance descriptor exists for:\n  ${instanceId}`);
    }
    throw error;
  }
  let text: string;
  try {
    text = await runtime.fs.readFile(filePath, 'utf8');
  } catch {
    throw ioError(`Unable to read instance descriptor:\n  ${filePath}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw credentialError(`Instance descriptor is not valid JSON:\n  ${filePath}`);
  }
  try {
    const parsed = parseInstanceDescriptor(raw);
    if (parsed.instance_id !== instanceId) {
      throw credentialError(
        `Instance descriptor identity mismatch:\n  file: ${instanceId}\n  contents: ${parsed.instance_id}`,
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.includes('mismatch')) throw error;
    const msg = error instanceof Error ? error.message : 'invalid descriptor';
    throw credentialError(`Invalid instance descriptor (${msg}):\n  ${filePath}`);
  }
}

export async function listInstanceDescriptors(runtime: Runtime): Promise<InstanceDescriptor[]> {
  await ensureInstanceStore(runtime);
  let names: string[];
  try {
    names = await runtime.fs.readdir(instancesDir(runtime));
  } catch {
    return [];
  }
  const out: InstanceDescriptor[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    const id = parseInstanceId(name.slice(0, -'.json'.length));
    if (!id) continue;
    out.push(await readInstanceDescriptor(runtime, id));
  }
  return out;
}

export async function readActiveInstanceId(runtime: Runtime): Promise<InstanceId | null> {
  const filePath = activeInstancePath(runtime);
  try {
    await assertRegularNonSymlinkFile(runtime, filePath, 'active-instance');
  } catch (error) {
    if (error instanceof Error && /was not found/.test(error.message)) return null;
    throw error;
  }
  const text = (await runtime.fs.readFile(filePath, 'utf8')).trim();
  const id = parseActiveInstancePointer(text);
  if (!id) {
    throw credentialError(`active-instance does not contain a valid instance ID:\n  ${filePath}`);
  }
  return id;
}

export async function writeActiveInstanceId(
  runtime: Runtime,
  instanceId: InstanceId,
): Promise<void> {
  await ensureInstanceStore(runtime);
  // Ensure descriptor exists before selecting
  await readInstanceDescriptor(runtime, instanceId);
  await atomicWriteFile(runtime, activeInstancePath(runtime), `${instanceId}\n`, 0o600);
}

export async function resolveTargetInstanceId(
  runtime: Runtime,
  instanceFlag: string | undefined,
): Promise<InstanceId> {
  if (instanceFlag !== undefined) {
    const id = parseInstanceId(instanceFlag);
    if (!id) throw usageError('--instance requires a valid opaque instance ID.');
    await readInstanceDescriptor(runtime, id);
    return id;
  }
  const active = await readActiveInstanceId(runtime);
  if (!active) {
    throw credentialError(
      'No active administrative instance is selected.\n\nRun:\n  nrdocs instance list\n  nrdocs instance use <instance-id>',
    );
  }
  await readInstanceDescriptor(runtime, active);
  return active;
}

export function parseRequiredInstanceId(value: string | undefined): InstanceId {
  if (value === undefined) throw usageError('instance use requires an instance ID.');
  const id = parseInstanceId(value);
  if (!id) throw usageError('instance use requires a valid opaque instance ID.');
  return id;
}
