/**
 * Instance naming conventions for nrdocs Cloudflare resources.
 *
 * All resources use the pattern: nrdocs-{instance}-{suffix}
 * This ensures resources are identifiable and grouped in the Cloudflare dashboard.
 */

const INSTANCE_NAME_REGEX = /^[a-z0-9]([a-z0-9-]{0,18}[a-z0-9])?$/;
const MAX_INSTANCE_LENGTH = 20;

/**
 * Validates an instance name.
 * Rules:
 * - Lowercase alphanumeric + hyphens only
 * - 1–20 characters
 * - Cannot start or end with a hyphen
 */
export function validateInstanceName(name: string): { valid: boolean; error?: string } {
  if (!name) {
    return { valid: false, error: 'Instance name cannot be empty' };
  }

  if (name.length > MAX_INSTANCE_LENGTH) {
    return { valid: false, error: `Instance name must be ${MAX_INSTANCE_LENGTH} characters or fewer` };
  }

  if (!INSTANCE_NAME_REGEX.test(name)) {
    return {
      valid: false,
      error: 'Instance name must be lowercase alphanumeric with hyphens, cannot start or end with a hyphen',
    };
  }

  return { valid: true };
}

/**
 * Generates the Worker name for an instance.
 */
export function getWorkerName(instance: string): string {
  return `nrdocs-${instance}`;
}

/**
 * Generates the D1 database name for an instance.
 */
export function getD1Name(instance: string): string {
  return `nrdocs-${instance}-db`;
}

/**
 * Generates the R2 bucket name for an instance.
 */
export function getR2BucketName(instance: string): string {
  return `nrdocs-${instance}-artifacts`;
}

/**
 * Returns all resource names for an instance.
 */
export function getResourceNames(instance: string): {
  worker: string;
  d1: string;
  r2: string;
} {
  return {
    worker: getWorkerName(instance),
    d1: getD1Name(instance),
    r2: getR2BucketName(instance),
  };
}
