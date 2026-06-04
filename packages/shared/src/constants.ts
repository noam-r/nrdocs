/**
 * Shared constants for nrdocs.
 */

export const NRDOCS_VERSION = '0.1.0';

// Approval states
export const APPROVAL_STATES = ['pending', 'approved', 'disabled'] as const;

// Access modes
export const ACCESS_MODES = ['none', 'public', 'password'] as const;

// Build statuses
export const BUILD_STATUSES = ['uploading', 'success', 'failed'] as const;

// Reserved platform paths that take unconditional priority over repo routes
export const RESERVED_PATHS = [
  '/api',
  '/_nrdocs',
  '/favicon.ico',
  '/robots.txt',
  '/.well-known',
] as const;

// Artifact limits
export const DEFAULT_MAX_ARCHIVE_SIZE_MB = 50;
export const DEFAULT_MAX_FILE_COUNT = 5000;
export const DEFAULT_MAX_EXTRACTED_SIZE_MB = 200;
export const DEFAULT_MAX_SINGLE_FILE_SIZE_MB = 25;

// Password policy
export const DEFAULT_MIN_PASSWORD_LENGTH = 8;
export const DEFAULT_MAX_PASSWORD_LENGTH = 128;
export const DEFAULT_PBKDF2_ITERATIONS = 100_000;

// Password throttle
export const PASSWORD_THROTTLE_MAX_ATTEMPTS = 5;
export const PASSWORD_THROTTLE_WINDOW_MINUTES = 5;
export const PASSWORD_THROTTLE_LOCKOUT_MINUTES = 5;

// Allowed static file keys
export const ALLOWED_STATIC_KEYS = ['homepage', 'favicon', 'robots'] as const;

// Rejected extensions (executable / script types)
export const REJECTED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
