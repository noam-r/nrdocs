import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type GlobalStateConfigV1 = {
  version: 1;
  default_api_url?: string;
};

const DEFAULT_CONFIG: GlobalStateConfigV1 = { version: 1 };

function stateDir(): string {
  // Test/CI override to avoid touching real home directory.
  const override = process.env.NRDOCS_GLOBAL_STATE_DIR?.trim();
  if (override) return override;
  return join(homedir(), '.nrdocs');
}

function configPath(): string {
  return join(stateDir(), 'config.json');
}

function readJsonFile(path: string): unknown {
  const text = readFileSync(path, 'utf8');
  return JSON.parse(text) as unknown;
}

function isConfigV1(raw: unknown): raw is GlobalStateConfigV1 {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return false;
  if (r.default_api_url !== undefined && typeof r.default_api_url !== 'string') return false;
  return true;
}

export function loadGlobalConfig(): GlobalStateConfigV1 {
  const p = configPath();
  if (!existsSync(p)) return { ...DEFAULT_CONFIG };
  try {
    const raw = readJsonFile(p);
    if (!isConfigV1(raw)) return { ...DEFAULT_CONFIG };
    return raw;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function atomicWriteFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, path);
}

export function saveGlobalConfig(next: GlobalStateConfigV1): void {
  atomicWriteFile(configPath(), `${JSON.stringify(next, null, 2)}\n`);
}

export function getDefaultApiUrl(): string | undefined {
  const cfg = loadGlobalConfig();
  const url = cfg.default_api_url?.trim();
  return url || undefined;
}

export function setDefaultApiUrl(url: string): void {
  const trimmed = url.trim().replace(/\/$/, '');
  const cfg = loadGlobalConfig();
  saveGlobalConfig({ ...cfg, version: 1, default_api_url: trimmed });
}

export function clearDefaultApiUrl(): void {
  const cfg = loadGlobalConfig();
  if (cfg.default_api_url === undefined) return;
  const { default_api_url: _ignored, ...rest } = cfg;
  saveGlobalConfig({ ...(rest as GlobalStateConfigV1), version: 1 });
}

