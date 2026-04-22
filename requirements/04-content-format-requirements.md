# Content Format Requirements

## Format goals

The platform defines its own simpler content format instead of using MkDocs.

The format should be:
- easy to author in Git
- easy to render deterministically
- explicit enough for navigation and metadata
- narrow in scope for phase 1

## Content structure

A project repository must support:
- Markdown page files
- a project config file
- an explicit navigation config file
- an optional separate allowed-list file

## Navigation

- Navigation is defined explicitly in a nav config file.
- The nav config acts similarly to MkDocs-style explicit navigation.
- The system should not rely solely on filesystem discovery for the canonical menu.

## Page metadata

The following metadata is supported:
- `title`
- `order`
- `section`
- `hidden`
- `template`
- `tags`

Mandatory in phase 1:
- `title`
- `order`

## Template model

- Phase 1 uses a single standard template/layout.
- The format should allow a future template field without requiring a redesign.

## Unsupported in phase 1

The phase 1 content model does not require:
- attachments/downloadables
- search
- multiple templates as a user-facing feature
