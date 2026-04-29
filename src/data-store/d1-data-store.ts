import type {
  Project,
  NewProject,
  ProjectStatus,
  AccessPolicyEntry,
  OperationalEvent,
  Organization,
  OrganizationStatus,
  BootstrapToken,
  BootstrapTokenStatus,
  RepoProofChallenge,
  RepoProofChallengeAction,
  RepoProofChallengeStatus,
  RepoPublishToken,
  RepoPublishTokenStatus,
} from '../types';
import type { DataStore } from '../interfaces/data-store';
import type { ProjectListFilters } from '../interfaces/data-store';

/**
 * D1DataStore — Cloudflare D1 implementation of the DataStore interface.
 *
 * Phase 1 implementation backed by Cloudflare D1 (SQLite).
 * Requirement 14.1: D1 as system of record for project records,
 * access policy, admin overrides, repo-derived entries, and operational records.
 * Requirement 18.3: Abstracted behind the DataStore interface.
 */
export class D1DataStore implements DataStore {
  constructor(private readonly db: D1Database) {}

  // ── Project operations ──────────────────────────────────────────────

  async getProjectByOrgSlugAndProjectSlug(
    orgSlug: string,
    projectSlug: string,
  ): Promise<Project | null> {
    const row = await this.db
      .prepare(
        `SELECT p.* FROM projects p
         INNER JOIN organizations o ON p.org_id = o.id
         WHERE o.slug = ? AND p.slug = ?`,
      )
      .bind(orgSlug, projectSlug)
      .first();
    return row ? this.rowToProject(row as Record<string, unknown>) : null;
  }

  async getProjectById(id: string): Promise<Project | null> {
    const row = await this.db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .bind(id)
      .first();
    return row ? this.rowToProject(row) : null;
  }

  async getProjectByRepoIdentity(repoIdentity: string): Promise<Project | null> {
    const normalized = this.normalizeRepoIdentity(repoIdentity);
    const row = await this.db
      .prepare('SELECT * FROM projects WHERE repo_identity = ?')
      .bind(normalized)
      .first();
    return row ? this.rowToProject(row as Record<string, unknown>) : null;
  }

  async listProjects(filters: ProjectListFilters): Promise<Project[]> {
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
      'SELECT * FROM projects' +
      (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY updated_at DESC, created_at DESC';

    const { results } = await this.db.prepare(sql).bind(...values).all();
    return (results ?? []).map((row) => this.rowToProject(row as Record<string, unknown>));
  }

  async createProject(project: NewProject): Promise<Project> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const status: ProjectStatus = 'awaiting_approval';
    const passwordVersion = 0;

    // Resolve org_id: use provided value or fall back to default organization
    const orgId = project.org_id ?? (await this.getDefaultOrganization()).id;

    // Normalize repo_identity if provided
    const repoIdentity = project.repo_identity != null
      ? this.normalizeRepoIdentity(project.repo_identity)
      : null;

    try {
      await this.db
        .prepare(
          `INSERT INTO projects (id, slug, org_id, repo_url, title, description, status, access_mode, active_publish_pointer, password_hash, password_version, repo_identity, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`
        )
        .bind(
          id,
          project.slug,
          orgId,
          project.repo_url,
          project.title,
          project.description,
          status,
          project.access_mode,
          passwordVersion,
          repoIdentity,
          now,
          now,
        )
        .run();
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        throw new Error(
          `A project with slug "${project.slug}" already exists in this organization`,
        );
      }
      throw err;
    }

    return {
      id,
      slug: project.slug,
      org_id: orgId,
      repo_url: project.repo_url,
      title: project.title,
      description: project.description,
      status,
      access_mode: project.access_mode,
      active_publish_pointer: null,
      password_hash: null,
      password_version: passwordVersion,
      repo_identity: repoIdentity,
      created_at: now,
      updated_at: now,
    };
  }

  async updateProjectStatus(id: string, status: ProjectStatus): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?')
      .bind(status, now, id)
      .run();
  }

  async deleteProject(id: string): Promise<void> {
    // Delete associated rows first, then the project record itself.
    // repo_publish_tokens has a FOREIGN KEY to projects(id) (migration 0002),
    // so it must be deleted before deleting the project.
    await this.db.batch([
      this.db
        .prepare('DELETE FROM repo_publish_tokens WHERE project_id = ?')
        .bind(id),
      this.db
        .prepare(
          "DELETE FROM access_policy_entries WHERE scope_type = 'project' AND scope_value = ?",
        )
        .bind(id),
      this.db
        .prepare('DELETE FROM operational_events WHERE project_id = ?')
        .bind(id),
      this.db.prepare('DELETE FROM projects WHERE id = ?').bind(id),
    ]);
  }

  async updateActivePublishPointer(
    projectId: string,
    pointer: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        'UPDATE projects SET active_publish_pointer = ?, updated_at = ? WHERE id = ?',
      )
      .bind(pointer, now, projectId)
      .run();
  }

  // ── Access policy operations ────────────────────────────────────────

  async getAccessPolicies(projectId: string): Promise<AccessPolicyEntry[]> {
    const { results } = await this.db
      .prepare(
        "SELECT * FROM access_policy_entries WHERE scope_type = 'project' AND scope_value = ?",
      )
      .bind(projectId)
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
    projectId: string,
    entries: AccessPolicyEntry[],
  ): Promise<void> {
    const statements: D1PreparedStatement[] = [
      // Delete all existing repo-derived entries for this project.
      // Admin overrides (source='admin') are preserved.
      this.db
        .prepare(
          "DELETE FROM access_policy_entries WHERE scope_type = 'project' AND scope_value = ? AND source = 'repo'",
        )
        .bind(projectId),
      // Insert each new repo-derived entry with a fresh UUID.
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

  // ── Password operations ─────────────────────────────────────────────

  async getPasswordHash(
    projectId: string,
  ): Promise<{ hash: string; version: number } | null> {
    const row = await this.db
      .prepare(
        'SELECT password_hash, password_version FROM projects WHERE id = ?',
      )
      .bind(projectId)
      .first<{ password_hash: string | null; password_version: number }>();

    if (!row || row.password_hash === null) {
      return null;
    }

    return { hash: row.password_hash, version: row.password_version };
  }

  async setPasswordHash(projectId: string, hash: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        'UPDATE projects SET password_hash = ?, password_version = password_version + 1, updated_at = ? WHERE id = ?',
      )
      .bind(hash, now, projectId)
      .run();
  }

  async setProjectAccessMode(projectId: string, accessMode: Project['access_mode']): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare('UPDATE projects SET access_mode = ?, updated_at = ? WHERE id = ?')
      .bind(accessMode, now, projectId)
      .run();
  }

  async clearProjectPassword(projectId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        'UPDATE projects SET password_hash = NULL, password_version = password_version + 1, updated_at = ? WHERE id = ?',
      )
      .bind(now, projectId)
      .run();
  }

  // ── Repo-proof challenges ──────────────────────────────────────────

  async getRepoProofChallengeById(id: string): Promise<RepoProofChallenge | null> {
    const row = await this.db
      .prepare('SELECT * FROM repo_proof_challenges WHERE id = ?')
      .bind(id)
      .first();
    return row ? this.rowToRepoProofChallenge(row as Record<string, unknown>) : null;
  }

  async deleteIssuedRepoProofChallenges(projectId: string, action: RepoProofChallengeAction): Promise<void> {
    await this.db
      .prepare(
        'DELETE FROM repo_proof_challenges WHERE project_id = ? AND action = ? AND status = ?',
      )
      .bind(projectId, action, 'issued')
      .run();
  }

  async createRepoProofChallenge(challenge: RepoProofChallenge): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO repo_proof_challenges (
          id, project_id, repo_identity, action,
          public_token, private_token_hash, status,
          issued_at, expires_at,
          verified_at, opened_until, verify_ref, verify_sha,
          consumed_at,
          attempt_count_set, attempt_count_verify, last_denial_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        challenge.id,
        challenge.project_id,
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

  // ── Operational records ───────────────────────────────────────────

  async recordEvent(event: OperationalEvent): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO operational_events (id, project_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(
        event.id,
        event.project_id,
        event.event_type,
        event.detail,
        event.created_at,
      )
      .run();
  }

  private rowToRepoProofChallenge(row: Record<string, unknown>): RepoProofChallenge {
    return {
      id: row['id'] as string,
      project_id: row['project_id'] as string,
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

  // ── Organization operations ──────────────────────────────────────

  async getOrganizationById(id: string): Promise<Organization | null> {
    const row = await this.db
      .prepare('SELECT * FROM organizations WHERE id = ?')
      .bind(id)
      .first();
    return row ? this.rowToOrganization(row as Record<string, unknown>) : null;
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | null> {
    const row = await this.db
      .prepare('SELECT * FROM organizations WHERE slug = ?')
      .bind(slug)
      .first();
    return row ? this.rowToOrganization(row as Record<string, unknown>) : null;
  }

  async getDefaultOrganization(): Promise<Organization> {
    const org = await this.getOrganizationBySlug('default');
    if (!org) {
      throw new Error(
        'Default organization not found — migration may be incomplete',
      );
    }
    return org;
  }

  // ── Token operations ──────────────────────────────────────────────

  async getBootstrapTokenByJti(jti: string): Promise<BootstrapToken | null> {
    const row = await this.db
      .prepare('SELECT * FROM bootstrap_tokens WHERE jti = ?')
      .bind(jti)
      .first();
    return row ? this.rowToBootstrapToken(row as Record<string, unknown>) : null;
  }

  async createBootstrapToken(token: BootstrapToken): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO bootstrap_tokens (id, jti, org_id, status, created_by, created_at, expires_at, max_repos, repos_issued_count, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        token.id,
        token.jti,
        token.org_id,
        token.status,
        token.created_by,
        token.created_at,
        token.expires_at,
        token.max_repos,
        token.repos_issued_count,
        token.last_used_at,
      )
      .run();
  }

  async createRepoPublishToken(token: RepoPublishToken): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO repo_publish_tokens (id, jti, org_id, project_id, repo_identity, status, created_from_bootstrap_jti, created_at, expires_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        token.id,
        token.jti,
        token.org_id,
        token.project_id,
        token.repo_identity,
        token.status,
        token.created_from_bootstrap_jti,
        token.created_at,
        token.expires_at,
        token.last_used_at,
      )
      .run();
  }

  async tryReserveBootstrapRepoSlot(jti: string, maxRepos: number): Promise<boolean> {
    const res = await this.db
      .prepare(
        `UPDATE bootstrap_tokens SET repos_issued_count = repos_issued_count + 1, last_used_at = datetime('now')
         WHERE jti = ? AND repos_issued_count < ? AND status = 'active'`,
      )
      .bind(jti, maxRepos)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  async releaseBootstrapRepoSlot(jti: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE bootstrap_tokens SET repos_issued_count = CASE WHEN repos_issued_count > 0 THEN repos_issued_count - 1 ELSE 0 END WHERE jti = ?`,
      )
      .bind(jti)
      .run();
  }

  normalizeRepoIdentityForOnboard(value: string): string {
    return this.normalizeRepoIdentity(value);
  }

  async bootstrapOnboardInsertBundle(params: {
    projectId: string;
    orgId: string;
    slug: string;
    repoUrl: string;
    title: string;
    description: string;
    accessMode: Project['access_mode'];
    repoIdentity: string;
    createdAt: string;
    updatedAt: string;
    repoPublishToken: RepoPublishToken;
    operationalEvent: OperationalEvent;
  }): Promise<void> {
    const status: ProjectStatus = 'approved';
    const passwordVersion = 0;
    const t = params.repoPublishToken;
    const ev = params.operationalEvent;

    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO projects (id, slug, org_id, repo_url, title, description, status, access_mode, active_publish_pointer, password_hash, password_version, repo_identity, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
        )
        .bind(
          params.projectId,
          params.slug,
          params.orgId,
          params.repoUrl,
          params.title,
          params.description,
          status,
          params.accessMode,
          passwordVersion,
          params.repoIdentity,
          params.createdAt,
          params.updatedAt,
        ),
      this.db
        .prepare(
          `INSERT INTO repo_publish_tokens (id, jti, org_id, project_id, repo_identity, status, created_from_bootstrap_jti, created_at, expires_at, last_used_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          t.id,
          t.jti,
          t.org_id,
          t.project_id,
          t.repo_identity,
          t.status,
          t.created_from_bootstrap_jti,
          t.created_at,
          t.expires_at,
          t.last_used_at,
        ),
      this.db
        .prepare(
          'INSERT INTO operational_events (id, project_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(ev.id, ev.project_id, ev.event_type, ev.detail, ev.created_at),
    ]);
  }

  async getRepoPublishTokenByJti(jti: string): Promise<RepoPublishToken | null> {
    const row = await this.db
      .prepare('SELECT * FROM repo_publish_tokens WHERE jti = ?')
      .bind(jti)
      .first();
    return row ? this.rowToRepoPublishToken(row as Record<string, unknown>) : null;
  }

  async getRepoPublishTokenForProjectFromBootstrap(
    projectId: string,
    bootstrapJti: string,
  ): Promise<RepoPublishToken | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM repo_publish_tokens
         WHERE project_id = ? AND created_from_bootstrap_jti = ?
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .bind(projectId, bootstrapJti)
      .first();
    return row ? this.rowToRepoPublishToken(row as Record<string, unknown>) : null;
  }

  async updateRepoPublishTokenLastUsedAt(jti: string): Promise<void> {
    await this.db
      .prepare("UPDATE repo_publish_tokens SET last_used_at = datetime('now') WHERE jti = ?")
      .bind(jti)
      .run();
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private rowToOrganization(row: Record<string, unknown>): Organization {
    return {
      id: row['id'] as string,
      slug: row['slug'] as string,
      name: row['name'] as string,
      status: row['status'] as OrganizationStatus,
      created_at: row['created_at'] as string,
      updated_at: row['updated_at'] as string,
    };
  }

  private rowToBootstrapToken(row: Record<string, unknown>): BootstrapToken {
    return {
      id: row['id'] as string,
      jti: row['jti'] as string,
      org_id: row['org_id'] as string,
      status: row['status'] as BootstrapTokenStatus,
      created_by: row['created_by'] as string,
      created_at: row['created_at'] as string,
      expires_at: row['expires_at'] as string,
      max_repos: row['max_repos'] as number,
      repos_issued_count: row['repos_issued_count'] as number,
      last_used_at: (row['last_used_at'] as string) ?? null,
    };
  }

  private rowToRepoPublishToken(row: Record<string, unknown>): RepoPublishToken {
    return {
      id: row['id'] as string,
      jti: row['jti'] as string,
      org_id: row['org_id'] as string,
      project_id: row['project_id'] as string,
      repo_identity: row['repo_identity'] as string,
      status: row['status'] as RepoPublishTokenStatus,
      created_from_bootstrap_jti: row['created_from_bootstrap_jti'] as string,
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

  private rowToProject(row: Record<string, unknown>): Project {
    return {
      id: row['id'] as string,
      slug: row['slug'] as string,
      org_id: row['org_id'] as string,
      repo_url: row['repo_url'] as string,
      title: row['title'] as string,
      description: (row['description'] as string) ?? '',
      status: row['status'] as ProjectStatus,
      access_mode: row['access_mode'] as Project['access_mode'],
      active_publish_pointer:
        (row['active_publish_pointer'] as string) ?? null,
      password_hash: (row['password_hash'] as string) ?? null,
      password_version: row['password_version'] as number,
      repo_identity: (row['repo_identity'] as string) ?? null,
      created_at: row['created_at'] as string,
      updated_at: row['updated_at'] as string,
    };
  }
}
