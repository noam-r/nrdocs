import { parseInstanceId, type InstanceId } from './ids.js';
import { normalizeDisplayName } from './title.js';
import { parseHttpsServerUrl } from './credentials.js';

export type InstanceStatus = 'provisioning' | 'active' | 'degraded';

/** Non-secret resumable progress written by deploy. */
export type ReconciliationProgress = {
  completed_steps: string[];
  resume_hint?: string;
};

export type InstanceDescriptor = {
  instance_id: InstanceId;
  display_name: string;
  /** Empty string only while status is provisioning and origin is not yet known. */
  canonical_origin: string;
  /** Optional custom hostname; null when using workers.dev. */
  custom_hostname: string | null;
  account_id: string;
  resource_suffix: string;
  /** Empty string only while status is provisioning and D1 is not yet created. */
  database_id: string;
  bucket_name: string;
  worker_name: string;
  status: InstanceStatus;
  deployed_version: string;
  reconciliation: ReconciliationProgress | null;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const REQUIRED = [
  'instance_id',
  'display_name',
  'canonical_origin',
  'custom_hostname',
  'account_id',
  'resource_suffix',
  'database_id',
  'bucket_name',
  'worker_name',
  'status',
  'deployed_version',
  'reconciliation',
] as const;

const DEPLOY_STEPS = new Set(['preflight', 'd1', 'r2', 'migrations', 'worker', 'origin', 'smoke']);

export function parseReconciliationProgress(raw: unknown): ReconciliationProgress | null {
  if (raw === null) return null;
  if (!isPlainObject(raw)) throw new Error('invalid reconciliation');
  for (const key of Object.keys(raw)) {
    if (key !== 'completed_steps' && key !== 'resume_hint') {
      throw new Error(`unknown reconciliation field: ${key}`);
    }
  }
  if (!Array.isArray(raw.completed_steps))
    throw new Error('invalid reconciliation.completed_steps');
  const completed_steps: string[] = [];
  for (const step of raw.completed_steps) {
    if (typeof step !== 'string' || !DEPLOY_STEPS.has(step)) {
      throw new Error('invalid reconciliation step');
    }
    completed_steps.push(step);
  }
  if (raw.resume_hint !== undefined && typeof raw.resume_hint !== 'string') {
    throw new Error('invalid reconciliation.resume_hint');
  }
  return {
    completed_steps,
    ...(typeof raw.resume_hint === 'string' ? { resume_hint: raw.resume_hint } : {}),
  };
}

/** Lowercase hostname only — no scheme, port, path, query, fragment, or wildcard. */
export function parseCanonicalHostname(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value || value !== value.toLowerCase()) return null;
  if (/[:/?#*]/.test(value)) return null;
  if (value.startsWith('.') || value.endsWith('.') || value.includes('..')) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value)) {
    return null;
  }
  return value;
}

/** 20-character lowercase Crockford base32 resource suffix (no i/l/o/u). */
export function parseResourceSuffix(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!/^[0-9abcdefghjkmnpqrstvwxyz]{20}$/.test(value)) return null;
  return value;
}

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

  const status = raw.status;
  if (status !== 'provisioning' && status !== 'active' && status !== 'degraded') {
    throw new Error('invalid instance status');
  }

  let canonical_origin: string;
  if (typeof raw.canonical_origin !== 'string') throw new Error('invalid canonical_origin');
  if (raw.canonical_origin === '') {
    if (status !== 'provisioning')
      throw new Error('canonical_origin required when not provisioning');
    canonical_origin = '';
  } else {
    const origin = parseHttpsServerUrl(raw.canonical_origin);
    if (!origin) throw new Error('invalid canonical_origin');
    canonical_origin = origin;
  }

  let custom_hostname: string | null;
  if (raw.custom_hostname === null) {
    custom_hostname = null;
  } else {
    custom_hostname = parseCanonicalHostname(raw.custom_hostname);
    if (!custom_hostname) throw new Error('invalid custom_hostname');
  }

  const resource_suffix = parseResourceSuffix(raw.resource_suffix);
  if (!resource_suffix) throw new Error('invalid resource_suffix');

  for (const key of ['account_id', 'bucket_name', 'worker_name', 'deployed_version'] as const) {
    if (typeof raw[key] !== 'string' || !(raw[key] as string).trim()) {
      throw new Error(`invalid ${key}`);
    }
  }

  if (typeof raw.database_id !== 'string') throw new Error('invalid database_id');
  if (raw.database_id === '') {
    if (status !== 'provisioning') throw new Error('database_id required when not provisioning');
  } else if (!raw.database_id.trim()) {
    throw new Error('invalid database_id');
  }

  return {
    instance_id,
    display_name,
    canonical_origin,
    custom_hostname,
    account_id: raw.account_id as string,
    resource_suffix,
    database_id: raw.database_id,
    bucket_name: raw.bucket_name as string,
    worker_name: raw.worker_name as string,
    status,
    deployed_version: raw.deployed_version as string,
    reconciliation: parseReconciliationProgress(raw.reconciliation),
  };
}

export function parseActiveInstancePointer(value: unknown): InstanceId | null {
  if (typeof value !== 'string') return null;
  return parseInstanceId(value.trim());
}

export function resourceNamesFor(
  accountId: string,
  suffix: string,
): { worker_name: string; database_name: string; bucket_name: string } {
  const parsed = parseResourceSuffix(suffix);
  if (!parsed) throw new Error('invalid resource suffix');
  if (!accountId || accountId.length < 8) throw new Error('invalid account id');
  return {
    worker_name: `nrdocs-${parsed}`,
    database_name: `nrdocs-${parsed}-d1`,
    bucket_name: `nrdocs-${accountId.slice(0, 8).toLowerCase()}-${parsed}-r2`,
  };
}
