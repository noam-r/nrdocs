// ── Enums ────────────────────────────────────────────────────────────

/** Lifecycle status of a registered repo (docs site). */
export type RepoStatus = 'awaiting_approval' | 'approved' | 'disabled';

/** Access protection mode for a published site. */
export type AccessMode = 'public' | 'password';

/** Operational event types recorded in the audit log. */
export type EventType =
  | 'registration'
  | 'approval'
  | 'disable'
  | 'delete'
  | 'publish_start'
  | 'publish_success'
  | 'publish_failure'
  | 'publish_token_mint'
  | 'repo_identity_bound'
  | 'login_failure'
  | 'repo_proof_challenge_issued'
  | 'repo_proof_challenge_verify_success'
  | 'repo_proof_password_set_success'
  | 'repo_proof_disable_password_success';

// ── Token types ──────────────────────────────────────────────────────

/** Lifecycle status of a repo publish token. */
export type RepoPublishTokenStatus = 'active' | 'revoked' | 'expired';

/** How the repo publish JWT was created. */
export type RepoPublishTokenSource = 'oidc' | 'mint';

/** A repo publish token bound to one registered repo. */
export interface RepoPublishToken {
  id: string;
  jti: string;
  repo_id: string;
  repo_identity: string;
  status: RepoPublishTokenStatus;
  token_source: RepoPublishTokenSource;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
}

// ── Repo-proof challenge types ───────────────────────────────────────

export type RepoProofChallengeAction =
  | 'set_password'
  | 'disable_password'
  | 'set_access_mode';

export type RepoProofChallengeStatus =
  | 'issued'
  | 'verified_by_push'
  | 'consumed_success'
  | 'consumed_failure'
  | 'expired';

export interface RepoProofChallenge {
  id: string;
  repo_id: string;
  repo_identity: string;
  action: RepoProofChallengeAction;
  public_token: string;
  private_token_hash: string;
  status: RepoProofChallengeStatus;
  issued_at: string;
  expires_at: string;
  verified_at: string | null;
  opened_until: string | null;
  verify_ref: string | null;
  verify_sha: string | null;
  consumed_at: string | null;
  attempt_count_set: number;
  attempt_count_verify: number;
  last_denial_reason: string | null;
}

// ── Repo types ───────────────────────────────────────────────────────

/** A registered documentation site row in D1. */
export interface Repo {
  id: string;
  slug: string;
  repo_url: string;
  title: string;
  description: string;
  status: RepoStatus;
  access_mode: AccessMode;
  active_publish_pointer: string | null;
  password_hash: string | null;
  password_version: number;
  repo_identity: string | null;
  created_at: string;
  updated_at: string;
}

/** Payload for registering a new repo. */
export interface NewRepo {
  slug: string;
  repo_url: string;
  title: string;
  description: string;
  access_mode: AccessMode;
  repo_identity?: string | null;
}

// ── Access policy types ──────────────────────────────────────────────

/** A single row in the `access_policy_entries` table. */
export interface AccessPolicyEntry {
  id: string;
  scope_type: 'platform' | 'repo';
  scope_value: string;
  subject_type: 'email' | 'domain';
  subject_value: string;
  effect: 'allow' | 'deny';
  source: 'admin' | 'repo';
  created_at: string;
}

// ── Operational event types ──────────────────────────────────────────

/** A single row in the `operational_events` table. */
export interface OperationalEvent {
  id: string;
  repo_id: string | null;
  event_type: EventType;
  detail: string | null;
  created_at: string;
}

// ── Session token types ──────────────────────────────────────────────

/** JSON payload embedded in a session token. */
export interface SessionTokenPayload {
  /** Token format version. */
  v: number;
  /** Repo ID (internal UUID). */
  rid: string;
  /** Issued-at timestamp (seconds since epoch). */
  iat: number;
  /** Expiry timestamp (seconds since epoch). */
  exp: number;
  /** Password version at time of issuance. */
  pv: number;
}

/** Result of validating a session token. */
export type TokenValidationResult =
  | { valid: true; repoId: string }
  | { valid: false; reason: string };

// ── Repo config types (docs/project.yml in a Git repo) ───────────────

/** Schema for `project.yml` in a documentation repository. */
export interface ProjectConfig {
  slug: string;
  title: string;
  description: string;
  publish_enabled: boolean;
  access_mode: AccessMode;
}

/** A single navigation item in `nav.yml`. */
export interface NavItem {
  label: string;
  path?: string;
  section?: boolean;
  children?: NavItem[];
}

/** Schema for `nav.yml`. */
export interface NavConfig {
  nav: NavItem[];
}

/** Schema for `allowed-list.yml`. */
export interface AllowedListConfig {
  allow: string[];
}

/** YAML frontmatter for a Markdown content page. */
export interface PageFrontmatter {
  title?: string;
  order?: number;
  section?: string;
  hidden?: boolean;
  template?: string;
  tags?: string[];
}
