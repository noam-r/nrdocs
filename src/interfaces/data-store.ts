import type {
  Project,
  NewProject,
  ProjectStatus,
  AccessMode,
  AccessPolicyEntry,
  OperationalEvent,
  Organization,
  BootstrapToken,
  RepoPublishToken,
  RepoProofChallenge,
  RepoProofChallengeAction,
  RepoProofChallengeStatus,
} from '../types';

export interface ProjectListFilters {
  status?: ProjectStatus;
  name?: string;
  slug?: string;
  title?: string;
  repo_identity?: string;
  access_mode?: AccessMode;
}

/**
 * DataStore — platform-agnostic interface for database operations.
 *
 * Phase 1 implementation: D1DataStore backed by Cloudflare D1.
 * Abstracted per Requirement 18.3 so alternative databases
 * can be substituted without modifying core logic.
 */
export interface DataStore {
  // ── Project operations ────────────────────────────────────────────

  /**
   * Look up a project by organization URL slug and project slug.
   * Organization slug is the `organizations.slug` value (e.g. `default`, `acme`).
   */
  getProjectByOrgSlugAndProjectSlug(
    orgSlug: string,
    projectSlug: string,
  ): Promise<Project | null>;

  /** Look up a project by its internal ID. Returns null if not found. */
  getProjectById(id: string): Promise<Project | null>;

  /** Look up a project by its repo identity (e.g. github.com/owner/repo). */
  getProjectByRepoIdentity(repoIdentity: string): Promise<Project | null>;

  /** List projects, filtered by lifecycle/status and common metadata fields. */
  listProjects(filters: ProjectListFilters): Promise<Project[]>;

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

  /** Update the project's access_mode (public|password). */
  setProjectAccessMode(projectId: string, accessMode: Project['access_mode']): Promise<void>;

  /** Clear password hash and bump password_version (invalidates sessions). */
  clearProjectPassword(projectId: string): Promise<void>;

  // ── Repo-proof challenges ──────────────────────────────────────────

  getRepoProofChallengeById(id: string): Promise<RepoProofChallenge | null>;
  /** Remove pending (issued) challenges so a new challenge can be minted with a fresh private token. */
  deleteIssuedRepoProofChallenges(projectId: string, action: RepoProofChallengeAction): Promise<void>;
  createRepoProofChallenge(challenge: RepoProofChallenge): Promise<void>;
  incrementRepoProofChallengeVerifyAttempts(id: string): Promise<void>;
  incrementRepoProofChallengeSetAttempts(id: string, denialReason: string): Promise<void>;
  markRepoProofChallengeVerified(
    id: string,
    opts: { verify_ref: string; verify_sha: string; opened_until: string },
  ): Promise<void>;
  consumeRepoProofChallenge(
    id: string,
    opts: { status: RepoProofChallengeStatus; consumed_at: string },
  ): Promise<boolean>;

  // ── Operational records ───────────────────────────────────────────

  /** Record an operational event (registration, approval, publish, etc.) in the audit log. */
  recordEvent(event: OperationalEvent): Promise<void>;

  // ── Organization operations ───────────────────────────────────────

  /** Look up an organization by its internal ID. Returns null if not found. */
  getOrganizationById(id: string): Promise<Organization | null>;

  /** Look up an organization by its URL slug. Returns null if not found. */
  getOrganizationBySlug(slug: string): Promise<Organization | null>;

  /** Retrieve the default organization (slug `default`). Throws if missing. */
  getDefaultOrganization(): Promise<Organization>;

  // ── Token operations ──────────────────────────────────────────────

  /** Look up a bootstrap token by its JTI. Returns null if not found. */
  getBootstrapTokenByJti(jti: string): Promise<BootstrapToken | null>;

  /** Insert a new bootstrap token row. */
  createBootstrapToken(token: BootstrapToken): Promise<void>;

  /** Insert a new repo publish token row. */
  createRepoPublishToken(token: RepoPublishToken): Promise<void>;

  /**
   * Atomically increment bootstrap `repos_issued_count` if below `maxRepos`.
   * Returns true if a slot was reserved, false if quota is exhausted.
   */
  tryReserveBootstrapRepoSlot(jti: string, maxRepos: number): Promise<boolean>;

  /** Undo one `tryReserveBootstrapRepoSlot` after a failed onboard write. */
  releaseBootstrapRepoSlot(jti: string): Promise<void>;

  /**
   * Insert approved project, repo publish token row, and registration event in one D1 batch.
   * Used by bootstrap onboard after a quota slot is reserved.
   */
  bootstrapOnboardInsertBundle(params: {
    projectId: string;
    orgId: string;
    slug: string;
    repoUrl: string;
    title: string;
    description: string;
    accessMode: AccessMode;
    repoIdentity: string;
    createdAt: string;
    updatedAt: string;
    repoPublishToken: RepoPublishToken;
    operationalEvent: OperationalEvent;
  }): Promise<void>;

  /** Validate and normalize repo_identity for onboarding (github.com/owner/repo). */
  normalizeRepoIdentityForOnboard(value: string): string;

  /** Look up a repo publish token by its JTI. Returns null if not found. */
  getRepoPublishTokenByJti(jti: string): Promise<RepoPublishToken | null>;

  /** Look up a repo publish token created for a project by a specific bootstrap token. */
  getRepoPublishTokenForProjectFromBootstrap(
    projectId: string,
    bootstrapJti: string,
  ): Promise<RepoPublishToken | null>;

  /** Update last_used_at timestamp for a repo publish token. */
  updateRepoPublishTokenLastUsedAt(jti: string): Promise<void>;
}
