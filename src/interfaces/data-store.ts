import type {
  Project,
  NewProject,
  ProjectStatus,
  AccessPolicyEntry,
  OperationalEvent,
} from '../types';

/**
 * DataStore — platform-agnostic interface for database operations.
 *
 * Phase 1 implementation: D1DataStore backed by Cloudflare D1.
 * Abstracted per Requirement 18.3 so alternative databases
 * can be substituted without modifying core logic.
 */
export interface DataStore {
  // ── Project operations ────────────────────────────────────────────

  /** Look up a project by its URL slug. Returns null if not found. */
  getProjectBySlug(slug: string): Promise<Project | null>;

  /** Look up a project by its internal ID. Returns null if not found. */
  getProjectById(id: string): Promise<Project | null>;

  /** Register a new project. Assigns a unique ID and sets initial status. */
  createProject(project: NewProject): Promise<Project>;

  /** Transition a project to a new lifecycle status. */
  updateProjectStatus(id: string, status: ProjectStatus): Promise<void>;

  /** Delete a project record and all associated state from the database. */
  deleteProject(id: string): Promise<void>;

  /** Atomically update the active publish pointer for a project. */
  updateActivePublishPointer(projectId: string, pointer: string): Promise<void>;

  // ── Access policy operations ──────────────────────────────────────

  /** Get all access policy entries (admin overrides + repo-derived) for a project. */
  getAccessPolicies(projectId: string): Promise<AccessPolicyEntry[]>;

  /** Get all platform-scoped access policy entries. */
  getPlatformPolicies(): Promise<AccessPolicyEntry[]>;

  /**
   * Replace all repo-derived access entries for a project.
   * Deletes existing repo-derived entries and inserts the new set in a
   * transaction, preserving all admin override entries for the project.
   */
  replaceRepoDerivedEntries(projectId: string, entries: AccessPolicyEntry[]): Promise<void>;

  /** Create or update an admin override access policy entry. */
  upsertAdminOverride(entry: AccessPolicyEntry): Promise<void>;

  /** Delete an admin override access policy entry by ID. */
  deleteAdminOverride(entryId: string): Promise<void>;

  // ── Password operations ───────────────────────────────────────────
  // password_hash and password_version are stored on the projects table.
  // These methods are convenience accessors that operate on the project record.

  /** Retrieve the current password hash and version for a project. Returns null if unset. */
  getPasswordHash(projectId: string): Promise<{ hash: string; version: number } | null>;

  /**
   * Set a new password hash for a project.
   * The implementation auto-increments password_version, invalidating
   * all existing session tokens for the project.
   */
  setPasswordHash(projectId: string, hash: string): Promise<void>;

  // ── Operational records ───────────────────────────────────────────

  /** Record an operational event (registration, approval, publish, etc.) in the audit log. */
  recordEvent(event: OperationalEvent): Promise<void>;
}
