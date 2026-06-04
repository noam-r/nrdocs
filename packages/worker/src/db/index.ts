/**
 * Database access layer barrel export.
 */

export { generateId } from './id.js';
export type { IdPrefix } from './id.js';

export {
  normalizeRepo,
  findRepoByFullName,
  findRepoByGithubId,
  upsertRepo,
  approveRepo,
  disableRepo,
  setAccessMode,
  setSelfPasswordAllowFlag,
  updateLatestBuild,
  listRepos,
} from './repos.js';
export type { UpsertRepoInput, ListReposFilters } from './repos.js';

export {
  createBuild,
  markBuildSuccess,
  markBuildFailed,
  findBuildById,
} from './builds.js';
export type { CreateBuildInput } from './builds.js';

export {
  createRule,
  deleteRule,
  listRules,
  matchRules,
  findMatchingRule,
} from './rules.js';

export {
  setPassword,
  getActivePassword,
  hasPassword,
  storeSelfServicePassword,
} from './passwords.js';
export type { StoreSelfServicePasswordArgs } from './passwords.js';

export { writeAuditEvent } from './audit.js';
export type { AuditEventInput } from './audit.js';

export {
  validateApproval,
  validateDisable,
  validateAccessChange,
  canServe,
} from './transitions.js';
export type { ValidationResult, ServeResult } from './transitions.js';
