# Publish Flow

## Registration
Phase 1 uses explicit admin registration.
A project must be registered and approved before publishing is allowed.

## Publish trigger
Publishing is automatic after an authorized publish trigger.
The control plane invokes the project publish workflow.

## Publish responsibilities
A publish operation performs:
1. validate project registration and approval
2. read repository config and content
3. build the static site
4. upload site artifacts to R2
5. replace repo-derived desired access entries in DB
6. reconcile edge access configuration if needed

## Safe activation rule
A publish becomes live only after the artifact upload succeeds.
Partial uploads must not become the active served state.

## Version handling
The platform does not maintain a separate project versioning system in phase 1.
Git history is the source of historical version information.
Rollback, if needed, is expected to be handled by reverting in Git and republishing.

## Config sync rule
Repo-to-DB synchronization happens only on publish.
Repo config changes do not affect DB state until a publish occurs.

## Change detection
Publish should perform sync/reconcile work only when necessary.
For example:
- if access config did not change, access sync may be skipped
- if only content changed, publish may update only artifacts
