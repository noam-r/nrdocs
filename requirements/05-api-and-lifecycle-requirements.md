# API and Lifecycle Requirements

## Admin/control plane scope for phase 1

The phase 1 control plane is publish-focused and must support:
- explicit project registration
- publish orchestration
- repository-config ingestion on publish
- state synchronization when required
- Cloudflare reconciliation when required

## Registration

- Projects must be created through an explicit admin API call.
- A project is not publishable until approved/registered.
- Repo binding is established at registration time and is immutable afterward.

## Publish flow

On publish, the control plane must:
1. validate project is approved/enabled
2. read the registered repository config
3. build/render the site content
4. update the live content only after full success
5. replace repository-derived desired allow entries for that project
6. update effective DB state as needed
7. reconcile Cloudflare access configuration as needed

## Config change handling

- Repository config changes have effect only on publish.
- No independent background sync is required in phase 1.

## Lifecycle actions

### Enable/approve
- allows project to publish and be served

### Disable
- blocks publishing
- makes project return `404`

### Delete
- removes project from the platform state in phase 1

## Session configuration

- Session duration is configurable at platform level.
- Default is 8 hours.
- This setting is not per-project in phase 1.
