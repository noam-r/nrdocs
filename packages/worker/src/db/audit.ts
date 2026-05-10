/**
 * Audit log query helpers for D1.
 */

import type { ActorType } from '@nrdocs/shared';
import { generateId } from './id.js';

export interface AuditEventInput {
  event_type: string;
  actor_type: ActorType;
  actor_id?: string;
  repo_id?: string;
  build_id?: string;
  rule_id?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAuditEvent(
  db: D1Database,
  event: AuditEventInput,
): Promise<void> {
  const id = generateId('evt_');
  const now = new Date().toISOString();
  const metadataJson = event.metadata ? JSON.stringify(event.metadata) : null;

  await db
    .prepare(
      `INSERT INTO audit_log (id, event_type, actor_type, actor_id, repo_id, build_id, rule_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      event.event_type,
      event.actor_type,
      event.actor_id ?? null,
      event.repo_id ?? null,
      event.build_id ?? null,
      event.rule_id ?? null,
      metadataJson,
      now,
    )
    .run();
}
