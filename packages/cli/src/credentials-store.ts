import {
  parseHttpsServerUrl,
  parsePublisherCredentialFile,
  parseSiteId,
  type PublisherCredentialFile,
  type SiteId,
} from '@nrdocs/contracts';
import type { Runtime } from './runtime.js';
import { credentialPath, nrdocsHome, sitesDir } from './runtime.js';
import {
  assertSecureCredentialFile,
  atomicWriteFile,
  ensurePrivateDir,
  removeFileIfExists,
} from './fs-safe.js';
import { credentialError, ioError, usageError } from './errors.js';

export type EnvCredentialPair = {
  server: string;
  token: string;
};

export type ResolvedPublisherCredential =
  | { source: 'env'; server: string; token: string }
  | { source: 'file'; server: string; token: string; path: string };

export function readEnvCredentialPair(runtime: Runtime): EnvCredentialPair | null {
  const url = runtime.env.NRDOCS_URL;
  const token = runtime.env.NRDOCS_TOKEN;
  const urlPresent = url !== undefined && url !== '';
  const tokenPresent = token !== undefined && token !== '';
  if (!urlPresent && !tokenPresent) return null;
  if (urlPresent !== tokenPresent) {
    throw credentialError(
      'NRDOCS_URL and NRDOCS_TOKEN must both be set together.\nIncomplete environment credentials are not used.',
    );
  }
  const server = parseHttpsServerUrl(url, true);
  if (!server) {
    throw credentialError(
      'NRDOCS_URL must be an https origin (http://127.0.0.1 is allowed locally).',
    );
  }
  if (typeof token !== 'string' || !/^nrd_pub_[A-Za-z0-9_-]{43}$/.test(token)) {
    throw credentialError('NRDOCS_TOKEN is malformed.');
  }
  return { server, token };
}

export async function ensureCredentialStore(runtime: Runtime): Promise<void> {
  await ensurePrivateDir(runtime, nrdocsHome(runtime));
  await ensurePrivateDir(runtime, sitesDir(runtime));
}

export async function writePublisherCredential(
  runtime: Runtime,
  siteId: SiteId,
  credential: PublisherCredentialFile,
): Promise<string> {
  await ensureCredentialStore(runtime);
  const filePath = credentialPath(runtime, siteId);
  const body = `${JSON.stringify({ server: credential.server, token: credential.token }, null, 2)}\n`;
  await atomicWriteFile(runtime, filePath, body, 0o600);
  await assertSecureCredentialFile(runtime, filePath);
  return filePath;
}

export async function readPublisherCredential(
  runtime: Runtime,
  siteId: SiteId,
): Promise<{ credential: PublisherCredentialFile; path: string }> {
  const filePath = credentialPath(runtime, siteId);
  try {
    await assertSecureCredentialFile(runtime, filePath);
  } catch (error) {
    if (error instanceof Error && /was not found/.test(error.message)) {
      throw credentialError(
        `No local credential exists for:\n  ${siteId}\n\nRun:\n  nrdocs connect <directory>`,
      );
    }
    throw error;
  }
  let text: string;
  try {
    text = await runtime.fs.readFile(filePath, 'utf8');
  } catch {
    throw ioError(`Unable to read credential file:\n  ${filePath}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw credentialError(`Credential file is not valid JSON:\n  ${filePath}`);
  }
  try {
    return { credential: parsePublisherCredentialFile(raw), path: filePath };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'invalid credential';
    throw credentialError(`Invalid credential file (${msg}):\n  ${filePath}`);
  }
}

export async function listPublisherCredentials(
  runtime: Runtime,
): Promise<Array<{ site_id: SiteId; server: string; path: string }>> {
  await ensureCredentialStore(runtime);
  let names: string[];
  try {
    names = await runtime.fs.readdir(sitesDir(runtime));
  } catch {
    return [];
  }
  const out: Array<{ site_id: SiteId; server: string; path: string }> = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    const siteId = parseSiteId(name.slice(0, -'.json'.length));
    if (!siteId) continue;
    const { credential, path: filePath } = await readPublisherCredential(runtime, siteId);
    out.push({ site_id: siteId, server: credential.server, path: filePath });
  }
  return out;
}

export async function removePublisherCredential(
  runtime: Runtime,
  siteIdArg: string,
): Promise<{ site_id: SiteId; removed: boolean }> {
  const siteId = parseSiteId(siteIdArg);
  if (!siteId) throw usageError('credentials remove requires a valid site ID.');
  await ensureCredentialStore(runtime);
  const filePath = credentialPath(runtime, siteId);
  const removed = await removeFileIfExists(runtime, filePath);
  return { site_id: siteId, removed };
}

export async function tryReadPublisherCredential(
  runtime: Runtime,
  siteId: SiteId,
): Promise<{ credential: PublisherCredentialFile; path: string } | null> {
  try {
    return await readPublisherCredential(runtime, siteId);
  } catch (error) {
    if (error instanceof Error && /No local credential exists/.test(error.message)) {
      return null;
    }
    throw error;
  }
}

/**
 * Resolve publisher credentials for a known expected site ID.
 * Does not contact the server (Phase 2).
 */
export async function resolvePublisherCredential(
  runtime: Runtime,
  expectedSiteId: SiteId,
): Promise<ResolvedPublisherCredential> {
  const envPair = readEnvCredentialPair(runtime);
  if (envPair) {
    return { source: 'env', server: envPair.server, token: envPair.token };
  }
  const { credential, path: filePath } = await readPublisherCredential(runtime, expectedSiteId);
  return { source: 'file', server: credential.server, token: credential.token, path: filePath };
}
