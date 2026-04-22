# Project Model and Lifecycle

## Project identity
A project is the deployment and policy unit.

Each project has:
- a unique project ID
- one immutable slug
- one immutable repo binding
- one access mode
- one lifecycle state

Projects are served at:
- `docs.example.com/<slug>/`

## Immutable fields
After registration, these fields are immutable:
- slug
- repo binding
- project ID
- access mode (for phase 1 design purposes)

If one of these must change, the project is treated as a new project.

## Lifecycle states

### `awaiting_approval`
- project is registered but not yet approved
- publishing is not allowed
- site is not available

### `approved`
- publishing is allowed
- site may be served according to its access mode

### `disabled`
- publishing is blocked
- requests return 404

## Deletion
In phase 1, deletion is an operation, not a persistent lifecycle state.
Deleting a project removes it from the platform database and removes it from active serving behavior.

## Unknown and disabled projects
Unknown and disabled projects both return 404.
This reduces unnecessary disclosure and keeps behavior simple.

## Authentication visibility
For protected projects, the platform may show the project title and login page before authentication.
