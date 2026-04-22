import type { AccessPolicyEntry } from '../types';

/** Result of evaluating access policy for a subject. */
export interface AccessPolicyResult {
  allowed: boolean;
  matchedRule: AccessPolicyEntry | null;
}

/**
 * Check whether a subject (email) matches an access policy entry.
 *
 * - subject_type='email': exact case-insensitive match against subject_value
 * - subject_type='domain': match if the email's domain matches the wildcard
 *   pattern (e.g. `*@example.com` matches `user@example.com`)
 */
function subjectMatches(entry: AccessPolicyEntry, subject: string): boolean {
  const normalised = subject.toLowerCase();

  if (entry.subject_type === 'email') {
    return normalised === entry.subject_value.toLowerCase();
  }

  // domain wildcard: subject_value is like `*@example.com`
  const pattern = entry.subject_value.toLowerCase();
  const wildcardPrefix = '*@';
  if (!pattern.startsWith(wildcardPrefix)) {
    return false;
  }
  const domain = pattern.slice(wildcardPrefix.length);
  const atIndex = normalised.indexOf('@');
  if (atIndex === -1) {
    return false;
  }
  return normalised.slice(atIndex + 1) === domain;
}

/**
 * Find the first entry in `entries` that matches `subject`.
 */
function findMatch(
  entries: AccessPolicyEntry[],
  subject: string,
): AccessPolicyEntry | undefined {
  return entries.find((e) => subjectMatches(e, subject));
}

/**
 * Evaluate access for a given subject against the layered policy.
 *
 * Evaluation order (first match wins):
 *  1. Platform deny  (scope_type='platform', effect='deny')  → deny
 *  2. Platform allow  (scope_type='platform', effect='allow') → allow
 *  3. Project deny   (scope_type='project', effect='deny', source='admin') → deny
 *  4. Project allow   (scope_type='project', effect='allow', source='admin') → allow
 *  5. Repo-derived allow (scope_type='project', effect='allow', source='repo') → allow
 *  6. Default → deny (matchedRule: null)
 *
 * This is a **pure function** — no side effects, no database access.
 *
 * @param subject          Email address of the user requesting access
 * @param _projectId       Project ID (reserved for future use / auditability)
 * @param platformPolicies Platform-scoped entries (scope_type='platform')
 * @param projectPolicies  Project-scoped entries (scope_type='project'), both
 *                         admin overrides and repo-derived
 */
export function evaluateAccess(
  subject: string,
  _projectId: string,
  platformPolicies: AccessPolicyEntry[],
  projectPolicies: AccessPolicyEntry[],
): AccessPolicyResult {
  // 1. Platform deny
  const platformDeny = findMatch(
    platformPolicies.filter((e) => e.effect === 'deny'),
    subject,
  );
  if (platformDeny) {
    return { allowed: false, matchedRule: platformDeny };
  }

  // 2. Platform allow
  const platformAllow = findMatch(
    platformPolicies.filter((e) => e.effect === 'allow'),
    subject,
  );
  if (platformAllow) {
    return { allowed: true, matchedRule: platformAllow };
  }

  // 3. Project deny (admin overrides only)
  const projectDeny = findMatch(
    projectPolicies.filter((e) => e.effect === 'deny' && e.source === 'admin'),
    subject,
  );
  if (projectDeny) {
    return { allowed: false, matchedRule: projectDeny };
  }

  // 4. Project allow (admin overrides only)
  const projectAllow = findMatch(
    projectPolicies.filter((e) => e.effect === 'allow' && e.source === 'admin'),
    subject,
  );
  if (projectAllow) {
    return { allowed: true, matchedRule: projectAllow };
  }

  // 5. Repo-derived allow
  const repoAllow = findMatch(
    projectPolicies.filter((e) => e.effect === 'allow' && e.source === 'repo'),
    subject,
  );
  if (repoAllow) {
    return { allowed: true, matchedRule: repoAllow };
  }

  // 6. Default deny
  return { allowed: false, matchedRule: null };
}
