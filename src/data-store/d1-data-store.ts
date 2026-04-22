import type {
  Project,
  NewProject,
  ProjectStatus,
  AccessPolicyEntry,
  OperationalEvent,
} from '../types';
import type { DataStore } from '../interfaces/data-store';

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

  async getProjectBySlug(slug: string): Promise<Project | null> {
    const row = await this.db
      .prepare('SELECT * FROM projects WHERE slug = ?')
      .bind(slug)
      .first();
    return row ? this.rowToProject(row) : null;
  }

  async getProjectById(id: string): Promise<Project | null> {
    const row = await this.db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .bind(id)
      .first();
    return row ? this.rowToProject(row) : null;
  }

  async createProject(project: NewProject): Promise<Project> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const status: ProjectStatus = 'awaiting_approval';
    const passwordVersion = 0;

    try {
      await this.db
        .prepare(
          `INSERT INTO projects (id, slug, repo_url, title, description, status, access_mode, active_publish_pointer, password_hash, password_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`
        )
        .bind(
          id,
          project.slug,
          project.repo_url,
          project.title,
          project.description,
          status,
          project.access_mode,
          passwordVersion,
          now,
          now,
        )
        .run();
    } catch (err: unknown) {
      // D1 throws on UNIQUE constraint violation for slug
      if (
        err instanceof Error &&
        err.message.includes('UNIQUE constraint failed')
      ) {
        throw new Error(
          `A project with slug "${project.slug}" already exists`,
        );
      }
      throw err;
    }

    return {
      id,
      slug: project.slug,
      repo_url: project.repo_url,
      title: project.title,
      description: project.description,
      status,
      access_mode: project.access_mode,
      active_publish_pointer: null,
      password_hash: null,
      password_version: passwordVersion,
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
    // Delete associated access_policy_entries and operational_events first,
    // then the project record itself.
    await this.db.batch([
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

  // ── Helpers ───────────────────────────────────────────────────────

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

  private rowToProject(row: Record<string, unknown>): Project {
    return {
      id: row['id'] as string,
      slug: row['slug'] as string,
      repo_url: row['repo_url'] as string,
      title: row['title'] as string,
      description: (row['description'] as string) ?? '',
      status: row['status'] as ProjectStatus,
      access_mode: row['access_mode'] as Project['access_mode'],
      active_publish_pointer:
        (row['active_publish_pointer'] as string) ?? null,
      password_hash: (row['password_hash'] as string) ?? null,
      password_version: row['password_version'] as number,
      created_at: row['created_at'] as string,
      updated_at: row['updated_at'] as string,
    };
  }
}
