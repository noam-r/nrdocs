/**
 * Core nrdocs types shared between Worker and CLI.
 */

// --- Enums ---

export type ApprovalState = 'pending' | 'approved' | 'disabled';

export type AccessMode = 'none' | 'public' | 'password';

export type BuildStatus = 'uploading' | 'success' | 'failed';

export type ActorType = 'operator' | 'github_action' | 'system';

// --- API Response Types ---

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// --- Repo ---

export interface RepoRecord {
  id: string;
  github_repository_id: string;
  owner: string;
  name: string;
  full_name: string;
  default_branch: string | null;
  approval_state: ApprovalState;
  access_mode: AccessMode;
  allow_repo_owner_password: boolean;
  latest_successful_build_id: string | null;
  last_publish_status: string | null;
  requested_access: string | null;
  site_title: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  approved_by: string | null;
  disabled_at: string | null;
  disabled_by: string | null;
}

// --- Build ---

export interface BuildRecord {
  id: string;
  repo_id: string;
  github_repository_id: string;
  git_sha: string;
  git_ref: string | null;
  workflow_ref: string | null;
  run_id: string | null;
  status: BuildStatus;
  artifact_prefix: string | null;
  artifact_manifest_key: string | null;
  artifact_size_bytes: number | null;
  file_count: number | null;
  content_hash: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

// --- Auto-Approval Rule ---

export interface AutoApprovalRule {
  id: string;
  pattern: string;
  access_mode: 'public' | 'password';
  enabled: boolean;
  priority: number;
  default_allow_repo_owner_password: boolean;
  /** When true, publish may include files whose extensions are not on the platform whitelist. */
  allow_unlisted_assets: boolean;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}

// --- Password Credential ---

export interface PasswordCredential {
  id: string;
  repo_id: string;
  password_hash: string;
  hash_algorithm: string;
  salt: string;
  iteration_count: number;
  password_version: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

// --- Audit Log ---

export interface AuditLogEntry {
  id: string;
  event_type: string;
  actor_type: ActorType;
  actor_id: string | null;
  repo_id: string | null;
  build_id: string | null;
  rule_id: string | null;
  metadata_json: string | null;
  created_at: string;
}
