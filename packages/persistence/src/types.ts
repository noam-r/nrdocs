import type {
  ArtifactId,
  Direction,
  InstanceId,
  LockId,
  SiteId,
  TokenRecordId,
} from '@nrdocs/contracts';

export type AccessMode = 'public' | 'password';

export type InstanceMetadataRow = {
  id: InstanceId;
  display_name: string;
  account_id: string;
  resource_suffix: string;
  canonical_origin: string;
  deployed_version: string;
  schema_version: number;
  created_at: string;
};

export type SiteRow = {
  id: SiteId;
  slug: string;
  enabled: boolean;
  access_mode: AccessMode;
  password_verifier: string | null;
  session_generation: number;
  current_artifact_id: ArtifactId | null;
  current_artifact_digest: string | null;
  current_root_route: string | null;
  current_language: string | null;
  current_direction: Direction | null;
  current_page_count: number | null;
  current_asset_count: number | null;
  current_attachment_count: number | null;
  last_published_at: string | null;
  publish_lock_id: LockId | null;
  publish_lock_acquired_at: string | null;
  publish_lock_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PublishingTokenRow = {
  id: TokenRecordId;
  site_id: SiteId;
  name: string;
  token_verifier: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
};

export type CurrentPublicationInput = {
  artifact_id: ArtifactId;
  artifact_digest: string;
  root_route: string;
  language: string;
  direction: Direction;
  page_count: number;
  asset_count: number;
  attachment_count: number;
};
