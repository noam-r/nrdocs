// ── Enums ────────────────────────────────────────────────────────────

/** Lifecycle status of a project. */
export type ProjectStatus = 'awaiting_approval' | 'approved' | 'disabled';

/** Access protection mode for a project. */
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
  | 'login_failure';

// ── Organization types ────────────────────────────────────────────────

/** Lifecycle status of an organization. */
export type OrganizationStatus = 'active' | 'disabled';

/** A fully-hydrated organization record as stored in D1. */
export interface Organization {
  id: string;
  slug: string;
  name: string;
  status: OrganizationStatus;
  created_at: string;
  updated_at: string;
}

// ── Token types ──────────────────────────────────────────────────────

/** Lifecycle status of a bootstrap token. */
export type BootstrapTokenStatus = 'active' | 'revoked' | 'expired';

/** A bootstrap token record scoped to an organization. */
export interface BootstrapToken {
  id: string;
  jti: string;
  org_id: string;
  status: BootstrapTokenStatus;
  created_by: string;
  created_at: string;
  expires_at: string;
  max_repos: number;
  repos_issued_count: number;
  last_used_at: string | null;
}

/** Lifecycle status of a repo publish token. */
export type RepoPublishTokenStatus = 'active' | 'revoked' | 'expired';

/** A repo publish token bound to one organization and one project. */
export interface RepoPublishToken {
  id: string;
  jti: string;
  org_id: string;
  project_id: string;
  repo_identity: string;
  status: RepoPublishTokenStatus;
  created_from_bootstrap_jti: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
}

// ── Project types ────────────────────────────────────────────────────

/** A fully-hydrated project record as stored in D1. */
export interface Project {
  id: string;
  slug: string;
  repo_url: string;
  title: string;
  description: string;
  status: ProjectStatus;
  access_mode: AccessMode;
  active_publish_pointer: string | null;
  password_hash: string | null;
  password_version: number;
  org_id: string;
  repo_identity: string | null;
  created_at: string;
  updated_at: string;
}

/** Payload for registering a new project (before ID / timestamps are assigned). */
export interface NewProject {
  slug: string;
  repo_url: string;
  title: string;
  description: string;
  access_mode: AccessMode;
  org_id?: string;
  repo_identity?: string | null;
}

// ── Access policy types ──────────────────────────────────────────────

/** A single row in the `access_policy_entries` table. */
export interface AccessPolicyEntry {
  id: string;
  scope_type: 'platform' | 'project';
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
  project_id: string | null;
  event_type: EventType;
  detail: string | null;
  created_at: string;
}

// ── Session token types ──────────────────────────────────────────────

/** JSON payload embedded in a session token. */
export interface SessionTokenPayload {
  /** Token format version. */
  v: number;
  /** Project ID (internal UUID, not the slug). */
  pid: string;
  /** Issued-at timestamp (seconds since epoch). */
  iat: number;
  /** Expiry timestamp (seconds since epoch). */
  exp: number;
  /** Password version at time of issuance. */
  pv: number;
}

/** Result of validating a session token. */
export type TokenValidationResult =
  | { valid: true; projectId: string }
  | { valid: false; reason: string };

// ── Repo config types ────────────────────────────────────────────────

/** Schema for `project.yml` in a project repository. */
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

/** Schema for `nav.yml` in a project repository. */
export interface NavConfig {
  nav: NavItem[];
}

/** Schema for `allowed-list.yml` in a project repository. */
export interface AllowedListConfig {
  allow: string[];
}

/** YAML frontmatter for a Markdown content page. All fields are optional. */
export interface PageFrontmatter {
  title?: string;
  order?: number;
  section?: string;
  hidden?: boolean;
  template?: string;
  tags?: string[];
}
