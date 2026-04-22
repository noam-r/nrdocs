# Repository Contract

## Purpose
Each project repository defines project-owner desired state and source content.
The repo is not the effective authority for access control.

## Required repository files
Suggested phase 1 structure:

```text
/
  project.yml           # main project config
  nav.yml               # explicit navigation definition
  allowed-list.yml      # optional desired access declarations
  /content              # markdown pages
```

## Main config
The main config declares:
- slug
- title
- description
- publish enabled
- access mode
- nav settings

## Navigation config
Navigation is explicit, similar in spirit to MkDocs.
This config defines:
- page hierarchy
- labels/titles
- order
- section layout

## Allow-list file
Access declarations should live in a separate file rather than being embedded in the main config.
The file may declare:
- allowed emails
- allowed domains / wildcard domains such as `*@example.com`

Repos may only declare `allow` rules.
Repos may never declare `deny` rules.

## Page metadata
Supported metadata includes:
- `title` (required)
- `order` (required)
- `section`
- `hidden`
- `template`
- `tags`

## Scope restriction
Repo-originated access declarations are scoped to the repo's own project only.
A repository may never create or modify access state for any other project.
This is a hard guardrail enforced during publish/sync.
