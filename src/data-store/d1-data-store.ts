import type {
  Repo,
  NewRepo,
  RepoStatus,
  AccessPolicyEntry,
  OperationalEvent,
  RepoProofChallenge,
  RepoProofChallengeAction,
  RepoProofChallengeStatus,
  RepoPublishToken,
  RepoPublishTokenStatus,
} from '../types';
import type { DataStore } from '../interfaces/data-store';
import type { RepoListFilters } from '../interfaces/data-store';

/**
 * D1DataStore — Cloudflare D1 implementation (single-tenant, `repos` table).
 */
export class D1DataStore implements DataStore {
  constructor(private readonly db: D1Database) {}

  async getRepoBySlug(slug: string): Promise<Repo | null> {
    const row = await this.db
      .prepare('SELECT * FROM repos WHERE slug = ?')
      .bind(slug)
      .first();
    return row ? this.rowToRepo(row as Record<string, unknown>) : null;
  }

  async getRepoById(id: string): Promise<Repo | null> {
    const row = await this.db
      .prepare('SELECT * FROM repos WHERE id = ?')
      .bind(id)
      .first();
    return row ? this.rowToRepo(row) : null;
  }

  async getRepoByRepoIdentity(repoIdentity: string): Promise<Repo | null> {
    const normalized = this.normalizeRepoIdentity(repoIdentity);
    const row = await this.db
      .prepare('SELECT * FROM repos WHERE repo_identity = ?')
      .bind(normalized)
      .first();
    return row ? this.rowToRepo(row as Record<string, unknown>) : null;
  }

  async listRepos(filters: RepoListFilters): Promise<Repo[]> {
    const where: string[] = [];
    const values: string[] = [];

    if (filters.status) {
      where.push('status = ?');
      values.push(filters.status);
    }
    if (filters.access_mode) {
      where.push('access_mode = ?');
      values.push(filters.access_mode);
    }
    if (filters.slug) {
      where.push('LOWER(slug) LIKE ?');
      values.push(`%${filters.slug.toLowerCase()}%`);
    }
    if (filters.title) {
      where.push('LOWER(title) LIKE ?');
      values.push(`%${filters.title.toLowerCase()}%`);
    }
    if (filters.name) {
      where.push('(LOWER(slug) LIKE ? OR LOWER(title) LIKE ?)');
      const name = `%${filters.name.toLowerCase()}%`;
      values.push(name, name);
    }
    if (filters.repo_identity) {
      where.push('LOWER(COALESCE(repo_identity, \'\')) LIKE ?');
      values.push(`%${filters.repo_identity.toLowerCase()}%`);
    }

    const sql =
      'SELECT * FROM repos' +
      (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY updated_at DESC, created_at DESC';

    const { results } = await this.db.prepare(sql).bind(...values).all();
    return (results ?? []).map((row) => this.rowToRepo(row as Record<string, unknown>));
  }

  async createRepo(repo: NewRepo): Promise<Repo> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const status: RepoStatus = 'awaiting_approval';
    const passwordVersion = 0;

    const repoIdentity = repo.repo_identity != null
      ? this.normalizeRepoIdentity(repo.repo_identity)
      : null;

    try {
      await this.db
        .prepare(
          `INSERT INTO repos (id, slug, repo_url, title, description, status, access_mode, active_publish_pointer, password_hash, password_version, repo_identity, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          repo.slug,
          repo.repo_url,
          repo.title,
          repo.description,
          status,
          repo.access_mode,
          passwordVersion,
          repoIdentity,
          now,
          now,
        )
        .run();
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        throw new Error(`A repo with slug "${repo.slug}" already exists`);
      }
      throw err;
    }

    return {
      id,
      slug: repo.slug,
      repo_url: repo.repo_url,
      title: repo.title,
      description: repo.description,
      status,
      access_mode: repo.access_mode,
      active_publish_pointer: null,
      password_hash: null,
      password_version: passwordVersion,
      repo_identity: repoIdentity,
      created_at: now,
      updated_at: now,
    };
  }

  async updateRepoStatus(id: string, status: RepoStatus): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare('UPDATE repos SET status = ?, updated_at = ? WHERE id = ?')
      .bind(status, now, id)
      .run();
  }

  async updateRepoRepoIdentity(id: string, repoIdentity: string): Promise<void> {
    const normalized = this.normalizeRepoIdentity(repoIdentity);
    const now = new Date().toISOString();
    await this.db
      .prepare('UPDATE repos SET repo_identity = ?, updated_at = ? WHERE id = ?')
      .bind(normalized, now, id)
      .run();
  }

  async deleteRepo(id: string): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM repo_publish_tokens WHERE repo_id = ?').bind(id),
      this.db
        .prepare(
          "DELETE FROM access_policy_entries WHERE scope_type = 'repo' AND scope_value = ?",
        )
        .bind(id),
      this.db.prepare('DELETE FROM operational_events WHERE repo_id = ?').bind(id),
      this.db.prepare('DELETE FROM repo_proof_challenges WHERE repo_id = ?').bind(id),
      this.db.prepare('DELETE FROM rate_limit_entries WHERE repo_id = ?').bind(id),
      this.db.prepare('DELETE FROM repos WHERE id = ?').bind(id),
    ]);
  }

  async updateActivePublishPointer(repoId: string, pointer: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        'UPDATE repos SET active_publish_pointer = ?, updated_at = ? WHERE id = ?',
      )
      .bind(pointer, now, repoId)
      .run();
  }

  async getAccessPolicies(repoId: string): Promise<AccessPolicyEntry[]> {
    const { results } = await this.db
      .prepare(
        "SELECT * FROM access_policy_entries WHERE scope_type = 'repo' AND scope_value = ?",
      )
      .bind(repoId)
      .all();
    return (results ?? []).map((row) =>
      this.rowToAccessPolicyEntry(row as Record<string, unknown>),
    );
  }

  async getPlatformPolicies(): Promise<AccessPolicyEntry[]> {
    const { results } = await this.db
      .prepare(
        "SELECT * FROM access_policy_entries WHERE scope_type = 'platform'",
      )
      .all();
    return (results ?? []).map((row) =>
      this.rowToAccessPolicyEntry(row as Record<string, unknown>),
    );
  }

  async replaceRepoDerivedEntries(
    repoId: string,
    entries: AccessPolicyEntry[],
  ): Promise<void> {
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          "DELETE FROM access_policy_entries WHERE scope_type = 'repo' AND scope_value = ? AND source = 'repo'",
        )
        .bind(repoId),
      ...entries.map((entry) =>
        this.db
          .prepare(
            `INSERT INTO access_policy_entries (id, scope_type, scope_value, subject_type, subject_value, effect, source, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            entry.scope_type,
            entry.scope_value,
            entry.subject_type,
            entry.subject_value,
            entry.effect,
            entry.source,
            entry.created_at,
          ),
      ),
    ];
    await this.db.batch(statements);
  }

  async upsertAdminOverride(entry: AccessPolicyEntry): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO access_policy_entries (id, scope_type, scope_value, subject_type, subject_value, effect, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        entry.id,
        entry.scope_type,
        entry.scope_value,
        entry.subject_type,
        entry.subject_value,
        entry.effect,
        entry.source,
        entry.created_at,
      )
      .run();
  }

  async deleteAdminOverride(entryId: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM access_policy_entries WHERE id = ?')
      .bind(entryId)
      .run();
  }

  async getPasswordHash(
    repoId: string,
  ): Promise<{ hash: string; version: number } | null> {
    const row = await this.db
      .prepare(
        'SELECT password_hash, password_version FROM repos WHERE id = ?',
      )
      .bind(repoId)
      .first<{ password_hash: string | null; password_version: number }>();

    if (!row || row.password_hash === null) {
      return null;
    }

    const version = Number(row.password_version);
    return { hash: row.password_hash, version: Number.isFinite(version) ? version : 0 };
  }

  async setPasswordHash(repoId: string, hash: string): Promise<void> {
    const now = new Date().toISOString();
    const result = await this.db
      .prepare(
        'UPDATE repos SET password_hash = ?, password_version = password_version + 1, updated_at = ? WHERE id = ?',
      )
      .bind(hash, now, repoId)
      .run();
    const changes = (result.meta as { changes?: number } | undefined)?.changes;
    if (changes === 0) {
      throw new Error(`setPasswordHash: no repo row updated for id "${repoId}"`);
    }
  }

  async setRepoAccessMode(repoId: string, accessMode: Repo['access_mode']): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare('UPDATE repos SET access_mode = ?, updated_at = ? WHERE id = ?')
      .bind(accessMode, now, repoId)
      .run();
  }

  async clearRepoPassword(repoId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        'UPDATE repos SET password_hash = NULL, password_version = password_version + 1, updated_at = ? WHERE id = ?',
      )
      .bind(now, repoId)
      .run();
  }

  async getRepoProofChallengeById(id: string): Promise<RepoProofChallenge | null> {
    const row = await this.db
      .prepare('SELECT * FROM repo_proof_challenges WHERE id = ?')
      .bind(id)
      .first();
    return row ? this.rowToRepoProofChallenge(row as Record<string, unknown>) : null;
  }

  async deleteIssuedRepoProofChallenges(repoId: string, action: RepoProofChallengeAction): Promise<void> {
    await this.db
      .prepare(
        'DELETE FROM repo_proof_challenges WHERE repo_id = ? AND action = ? AND status = ?',
      )
      .bind(repoId, action, 'issued')
      .run();
  }

  async createRepoProofChallenge(challenge: RepoProofChallenge): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO repo_proof_challenges (
          id, repo_id, repo_identity, action,
          public_token, private_token_hash, status,
          issued_at, expires_at,
          verified_at, opened_until, verify_ref, verify_sha,
          consumed_at,
          attempt_count_set, attempt_count_verify, last_denial_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        challenge.id,
        challenge.repo_id,
        challenge.repo_identity,
        challenge.action,
        challenge.public_token,
        challenge.private_token_hash,
        challenge.status,
        challenge.issued_at,
        challenge.expires_at,
        challenge.verified_at,
        challenge.opened_until,
        challenge.verify_ref,
        challenge.verify_sha,
        challenge.consumed_at,
        challenge.attempt_count_set,
        challenge.attempt_count_verify,
        challenge.last_denial_reason,
      )
      .run();
  }

  async incrementRepoProofChallengeVerifyAttempts(id: string): Promise<void> {
    await this.db
      .prepare(
        'UPDATE repo_proof_challenges SET attempt_count_verify = attempt_count_verify + 1 WHERE id = ?',
      )
      .bind(id)
      .run();
  }

  async incrementRepoProofChallengeSetAttempts(id: string, denialReason: string): Promise<void> {
    await this.db
      .prepare(
        'UPDATE repo_proof_challenges SET attempt_count_set = attempt_count_set + 1, last_denial_reason = ? WHERE id = ?',
      )
      .bind(denialReason, id)
      .run();
  }

  async markRepoProofChallengeVerified(
    id: string,
    opts: { verify_ref: string; verify_sha: string; opened_until: string },
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `UPDATE repo_proof_challenges
         SET status = 'verified_by_push',
             verified_at = ?,
             opened_until = ?,
             verify_ref = ?,
             verify_sha = ?
         WHERE id = ? AND status = 'issued'`,
      )
      .bind(now, opts.opened_until, opts.verify_ref, opts.verify_sha, id)
      .run();
  }

  async consumeRepoProofChallenge(
    id: string,
    opts: { status: RepoProofChallengeStatus; consumed_at: string },
  ): Promise<boolean> {
    const res = await this.db
      .prepare(
        `UPDATE repo_proof_challenges
         SET status = ?, consumed_at = ?
         WHERE id = ? AND status = 'verified_by_push'`,
      )
      .bind(opts.status, opts.consumed_at, id)
      .run();
    return (res.meta?.changes ?? 0) === 1;
  }

  async recordEvent(event: OperationalEvent): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO operational_events (id, repo_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(
        event.id,
        event.repo_id,
        event.event_type,
        event.detail,
        event.created_at,
      )
      .run();
  }

  async createRepoPublishToken(token: RepoPublishToken): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO repo_publish_tokens (id, jti, repo_id, repo_identity, status, token_source, created_at, expires_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        token.id,
        token.jti,
        token.repo_id,
        token.repo_identity,
        token.status,
        token.token_source,
        token.created_at,
        token.expires_at,
        token.last_used_at,
      )
      .run();
  }

  normalizeRepoIdentityForOnboard(value: string): string {
    return this.normalizeRepoIdentity(value);
  }

  async getRepoPublishTokenByJti(jti: string): Promise<RepoPublishToken | null> {
    const row = await this.db
      .prepare('SELECT * FROM repo_publish_tokens WHERE jti = ?')
      .bind(jti)
      .first();
    return row ? this.rowToRepoPublishToken(row as Record<string, unknown>) : null;
  }

  async updateRepoPublishTokenLastUsedAt(jti: string): Promise<void> {
    await this.db
      .prepare("UPDATE repo_publish_tokens SET last_used_at = datetime('now') WHERE jti = ?")
      .bind(jti)
      .run();
  }

  private rowToRepoPublishToken(row: Record<string, unknown>): RepoPublishToken {
    return {
      id: row['id'] as string,
      jti: row['jti'] as string,
      repo_id: row['repo_id'] as string,
      repo_identity: row['repo_identity'] as string,
      status: row['status'] as RepoPublishTokenStatus,
      token_source: row['token_source'] as RepoPublishToken['token_source'],
      created_at: row['created_at'] as string,
      expires_at: row['expires_at'] as string,
      last_used_at: (row['last_used_at'] as string) ?? null,
    };
  }

  private rowToAccessPolicyEntry(
    row: Record<string, unknown>,
  ): AccessPolicyEntry {
    return {
      id: row['id'] as string,
      scope_type: row['scope_type'] as AccessPolicyEntry['scope_type'],
      scope_value: row['scope_value'] as string,
      subject_type: row['subject_type'] as AccessPolicyEntry['subject_type'],
      subject_value: row['subject_value'] as string,
      effect: row['effect'] as AccessPolicyEntry['effect'],
      source: row['source'] as AccessPolicyEntry['source'],
      created_at: row['created_at'] as string,
    };
  }

  private rowToRepoProofChallenge(row: Record<string, unknown>): RepoProofChallenge {
    return {
      id: row['id'] as string,
      repo_id: row['repo_id'] as string,
      repo_identity: row['repo_identity'] as string,
      action: row['action'] as RepoProofChallengeAction,
      public_token: row['public_token'] as string,
      private_token_hash: row['private_token_hash'] as string,
      status: row['status'] as RepoProofChallengeStatus,
      issued_at: row['issued_at'] as string,
      expires_at: row['expires_at'] as string,
      verified_at: (row['verified_at'] as string) ?? null,
      opened_until: (row['opened_until'] as string) ?? null,
      verify_ref: (row['verify_ref'] as string) ?? null,
      verify_sha: (row['verify_sha'] as string) ?? null,
      consumed_at: (row['consumed_at'] as string) ?? null,
      attempt_count_set: (row['attempt_count_set'] as number) ?? 0,
      attempt_count_verify: (row['attempt_count_verify'] as number) ?? 0,
      last_denial_reason: (row['last_denial_reason'] as string) ?? null,
    };
  }

  private normalizeRepoIdentity(value: string): string {
    const normalized = value.trim().toLowerCase();
    const pattern = /^github\.com\/[a-z0-9._-]+\/[a-z0-9._-]+$/;
    if (!pattern.test(normalized)) {
      throw new Error(
        'Invalid repo_identity format. Expected: github.com/<owner>/<repo>',
      );
    }
    return normalized;
  }

  private rowToRepo(row: Record<string, unknown>): Repo {
    return {
      id: row['id'] as string,
      slug: row['slug'] as string,
      repo_url: row['repo_url'] as string,
      title: row['title'] as string,
      description: (row['description'] as string) ?? '',
      status: row['status'] as RepoStatus,
      access_mode: row['access_mode'] as Repo['access_mode'],
      active_publish_pointer:
        (row['active_publish_pointer'] as string) ?? null,
      password_hash: (row['password_hash'] as string) ?? null,
      password_version: (() => {
        const n = Number(row['password_version']);
        return Number.isFinite(n) ? n : 0;
      })(),
      repo_identity: (row['repo_identity'] as string) ?? null,
      created_at: row['created_at'] as string,
      updated_at: row['updated_at'] as string,
    };
  }
}
