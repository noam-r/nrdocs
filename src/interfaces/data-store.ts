import type {
  Repo,
  NewRepo,
  RepoStatus,
  AccessMode,
  AccessPolicyEntry,
  OperationalEvent,
  RepoPublishToken,
  RepoProofChallenge,
  RepoProofChallengeAction,
  RepoProofChallengeStatus,
} from '../types';

export interface RepoListFilters {
  status?: RepoStatus;
  name?: string;
  slug?: string;
  title?: string;
  repo_identity?: string;
  access_mode?: AccessMode;
}

/**
 * DataStore — platform-agnostic interface for database operations.
 * Single-tenant: flat list of registered repos (sites).
 */
export interface DataStore {
  /** Look up a repo by site slug (URL path segment). */
  getRepoBySlug(slug: string): Promise<Repo | null>;

  /** Look up a repo by its internal ID. */
  getRepoById(id: string): Promise<Repo | null>;

  /** Look up a repo by GitHub identity (e.g. github.com/owner/repo). */
  getRepoByRepoIdentity(repoIdentity: string): Promise<Repo | null>;

  /** List repos, filtered by lifecycle/status and metadata. */
  listRepos(filters: RepoListFilters): Promise<Repo[]>;

  /** Register a new repo. */
  createRepo(repo: NewRepo): Promise<Repo>;

  /** Transition a repo to a new lifecycle status. */
  updateRepoStatus(id: string, status: RepoStatus): Promise<void>;

  /** Delete a repo and associated state. */
  deleteRepo(id: string): Promise<void>;

  /** Atomically update the active publish pointer. */
  updateActivePublishPointer(repoId: string, pointer: string): Promise<void>;

  /** Set repo_identity when it was unset (OIDC mint backfill). */
  updateRepoRepoIdentity(id: string, repoIdentity: string): Promise<void>;

  // ── Access policy ──────────────────────────────────────────────────

  getAccessPolicies(repoId: string): Promise<AccessPolicyEntry[]>;

  getPlatformPolicies(): Promise<AccessPolicyEntry[]>;

  replaceRepoDerivedEntries(repoId: string, entries: AccessPolicyEntry[]): Promise<void>;

  upsertAdminOverride(entry: AccessPolicyEntry): Promise<void>;

  deleteAdminOverride(entryId: string): Promise<void>;

  // ── Password ───────────────────────────────────────────────────────

  getPasswordHash(repoId: string): Promise<{ hash: string; version: number } | null>;

  setPasswordHash(repoId: string, hash: string): Promise<void>;

  setRepoAccessMode(repoId: string, accessMode: Repo['access_mode']): Promise<void>;

  clearRepoPassword(repoId: string): Promise<void>;

  // ── Repo-proof challenges ───────────────────────────────────────────

  getRepoProofChallengeById(id: string): Promise<RepoProofChallenge | null>;
  deleteIssuedRepoProofChallenges(repoId: string, action: RepoProofChallengeAction): Promise<void>;
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

  // ── Operational records ────────────────────────────────────────────

  recordEvent(event: OperationalEvent): Promise<void>;

  // ── Repo publish tokens ───────────────────────────────────────────

  createRepoPublishToken(token: RepoPublishToken): Promise<void>;

  normalizeRepoIdentityForOnboard(value: string): string;

  getRepoPublishTokenByJti(jti: string): Promise<RepoPublishToken | null>;

  updateRepoPublishTokenLastUsedAt(jti: string): Promise<void>;
}
