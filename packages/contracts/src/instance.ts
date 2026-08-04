import { parseInstanceId, type InstanceId } from './ids.js';
import { normalizeDisplayName } from './title.js';
import { parseHttpsServerUrl } from './credentials.js';

export type InstanceStatus = 'provisioning' | 'active' | 'degraded';

export type InstanceDescriptor = {
  instance_id: InstanceId;
  display_name: string;
  canonical_origin: string;
  account_id: string;
  resource_suffix: string;
  database_id: string;
  bucket_name: string;
  worker_name: string;
  status: InstanceStatus;
  deployed_version: string;
  reconciliation: unknown;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const REQUIRED = [
  'instance_id',
  'display_name',
  'canonical_origin',
  'account_id',
  'resource_suffix',
  'database_id',
  'bucket_name',
  'worker_name',
  'status',
  'deployed_version',
  'reconciliation',
] as const;

export function parseInstanceDescriptor(raw: unknown): InstanceDescriptor {
  if (!isPlainObject(raw)) throw new Error('instance descriptor must be a JSON object');
  for (const key of Object.keys(raw)) {
    if (!(REQUIRED as readonly string[]).includes(key)) {
      throw new Error(`unknown instance descriptor field: ${key}`);
    }
  }
  for (const key of REQUIRED) {
    if (!(key in raw)) throw new Error(`missing instance descriptor field: ${key}`);
  }

  const instance_id = parseInstanceId(raw.instance_id);
  if (!instance_id) throw new Error('invalid instance_id');
  const display_name = normalizeDisplayName(raw.display_name);
  if (!display_name) throw new Error('invalid display_name');
  const canonical_origin = parseHttpsServerUrl(raw.canonical_origin);
  if (!canonical_origin) throw new Error('invalid canonical_origin');

  const status = raw.status;
  if (status !== 'provisioning' && status !== 'active' && status !== 'degraded') {
    throw new Error('invalid instance status');
  }

  for (const key of [
    'account_id',
    'resource_suffix',
    'database_id',
    'bucket_name',
    'worker_name',
    'deployed_version',
  ] as const) {
    if (typeof raw[key] !== 'string' || !(raw[key] as string).trim()) {
      throw new Error(`invalid ${key}`);
    }
  }

  return {
    instance_id,
    display_name,
    canonical_origin,
    account_id: raw.account_id as string,
    resource_suffix: raw.resource_suffix as string,
    database_id: raw.database_id as string,
    bucket_name: raw.bucket_name as string,
    worker_name: raw.worker_name as string,
    status,
    deployed_version: raw.deployed_version as string,
    reconciliation: raw.reconciliation,
  };
}

export function parseActiveInstancePointer(value: unknown): InstanceId | null {
  if (typeof value !== 'string') return null;
  return parseInstanceId(value.trim());
}
