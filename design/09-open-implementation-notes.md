# Implementation Notes and Non-Blocking Assumptions

## Direct serving vs Worker-mediated serving
The platform includes a Worker in all cases.
However, the design still prefers simple static serving semantics wherever practical.
In implementation terms:
- the Worker should stay thin
- public content should incur minimal logic
- routing or auth complexity should not be pushed into build artifacts unnecessarily

## Template support
Phase 1 uses a single docs template.
The renderer and build contract should avoid blocking future multi-template support.

## Search and attachments
These are out of scope for phase 1.
The content contract and storage layout should leave room for them later.

## Version history
Git is the source of version history in phase 1.
Future versions may render Git-derived history pages without introducing platform-managed versioned URLs.

## No multi-mode access per project in phase 1
Each project has a single access mode.
Future support for mixed modes is not required in the current design.
