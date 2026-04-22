# Requirements Document

## Introduction

nrdocs is a serverless private documentation publishing platform. It serves documentation minisites from Markdown repositories under a single shared hostname (`docs.example.com/<slug>/`). Each project maps to one repository, uses explicit admin registration, and supports public or password-protected access in phase 1. The platform uses a Cloudflare-only stack: Worker for request routing and auth, R2 for content storage, and D1 (SQLite) as the system of record. Repository config expresses project-owner desired state; the database stores authoritative effective state. Publishing is triggered by a GitHub Actions workflow in each project repo.

## Glossary

- **Platform**: The nrdocs documentation publishing system as a whole
- **Project**: A single documentation minisite bound to one repository and one immutable slug
- **Slug**: The immutable URL path segment identifying a project (e.g. `my-project` in `docs.example.com/my-project/`)
- **Worker**: The Cloudflare Worker that acts as the thin request router and authentication gate for all project requests
- **R2**: Cloudflare R2 object storage used to store built static site artifacts
- **D1**: Cloudflare D1 (SQLite) database used as the authoritative system of record for project state, access policy, and operational records
- **Control_Plane**: The admin/control API responsible for project registration, publish orchestration, state sync, and Cloudflare reconciliation
- **Repo_Config**: The set of configuration files in a project repository (`project.yml`, `nav.yml`, `allowed-list.yml`) expressing the project owner's desired state
- **Access_Mode**: The access protection type for a project — `public`, `password`, or future `invite_list`
- **Access_Policy_Engine**: The logical component that evaluates effective access by applying the layered precedence rules
- **Password_Hash**: A scrypt-derived hash of the project password stored in D1
- **Session_Token**: An HMAC-signed opaque token in the format `base64url(payload).base64url(signature)` used for password-mode session authentication
- **Publish_Flow**: The end-to-end process of validating, building, uploading, and activating a project's documentation
- **Allowed_List**: The optional `allowed-list.yml` file in a repository declaring project-local allow rules (emails and domain wildcards)
- **Admin_Override**: A platform or project-scoped access policy entry managed by an administrator, not derived from repository config
- **Repo_Derived_Entry**: An access policy entry sourced from a repository's `allowed-list.yml`, scoped to that repository's own project only
- **Nav_Config**: The explicit navigation configuration file (`nav.yml`) defining page hierarchy, labels, order, and section layout
- **Effective_State**: The authoritative state stored in D1, computed from admin overrides and repo-derived entries according to precedence rules
- **GitHub_Actions_Workflow**: The `.github/workflows` YAML file in each project repo that triggers the build and publish process on deployment events
- **Active_Publish_Pointer**: A reference stored in D1 that identifies the current live artifact set for a Project, enabling atomic cutover between publish versions
- **Password_Version**: A version identifier stored alongside the Password_Hash in D1, incremented on each password change, and embedded in Session_Tokens to enable immediate invalidation on password rotation

## Requirements

### Requirement 1: Project Identity and Routing

**User Story:** As a documentation consumer, I want to access any project's documentation via a predictable URL path under a single hostname, so that I can bookmark and share stable links.

#### Acceptance Criteria

1. THE Worker SHALL serve all projects from the single hostname `docs.example.com` using the first URL path segment as the project Slug
2. WHEN a request arrives at `docs.example.com/<slug>/...`, THE Worker SHALL resolve the Project by matching the first path segment to a registered Slug in D1
3. WHEN a request targets a Slug that does not match any registered Project, THE Worker SHALL return HTTP 404 with no disclosure of whether the Slug was ever registered
4. WHEN a request targets a Project with status `disabled`, THE Worker SHALL return HTTP 404 identical to the unknown-project response
5. THE Platform SHALL enforce that each Project has exactly one immutable Slug assigned at registration time
6. THE Platform SHALL enforce that each Slug is unique across all Projects
7. WHEN a request targets a deep path such as `docs.example.com/<slug>/section/page/`, THE Worker SHALL resolve the Project from the first path segment and serve the corresponding content
8. WHEN a request path ends with a trailing slash (e.g. `/<slug>/section/page/`), THE Worker SHALL resolve the path to the corresponding `index.html` object in R2 (e.g. `<slug>/section/page/index.html`)
9. WHEN a request path does not end with a trailing slash and does not include a file extension, THE Worker SHALL redirect to the trailing-slash form with an HTTP 301 so that relative links resolve correctly
10. WHEN a request path includes a file extension (e.g. `.html`, `.css`, `.js`), THE Worker SHALL serve the object at the literal R2 path without appending `index.html`

### Requirement 2: Project Registration and Lifecycle

**User Story:** As a platform administrator, I want to explicitly register and manage project lifecycle states, so that only approved projects can publish and be served.

#### Acceptance Criteria

1. THE Control_Plane SHALL require an explicit admin API call to register a new Project
2. WHEN a Project is registered, THE Control_Plane SHALL assign a unique project ID, bind the Project to exactly one repository, and set the initial status to `awaiting_approval`
3. THE Platform SHALL enforce that the project ID, Slug, repository binding, and Access_Mode are immutable after registration
4. WHILE a Project has status `awaiting_approval`, THE Worker SHALL not serve content for that Project and THE Control_Plane SHALL reject publish requests for that Project
5. WHEN an administrator approves a Project, THE Control_Plane SHALL transition the Project status to `approved`
6. WHILE a Project has status `approved`, THE Control_Plane SHALL accept publish requests and THE Worker SHALL serve content according to the Project's Access_Mode
7. WHEN an administrator disables a Project, THE Control_Plane SHALL transition the Project status to `disabled`
8. WHILE a Project has status `disabled`, THE Worker SHALL return HTTP 404 for all requests to that Project's Slug and THE Control_Plane SHALL reject publish requests
9. WHEN an administrator deletes a Project, THE Control_Plane SHALL remove the Project record and all associated state from D1, and SHALL remove all R2 artifacts and Cloudflare access configuration associated with that Project as specified in Requirement 21
10. IF a registration request specifies a Slug that is already in use, THEN THE Control_Plane SHALL reject the request with an error indicating the Slug conflict

### Requirement 3: Publish Flow

**User Story:** As a project owner, I want my documentation to be automatically built and published when I trigger a deployment, so that my docs site stays current with my repository content.

#### Acceptance Criteria

1. WHEN a GitHub_Actions_Workflow triggers a publish for a Project, THE Control_Plane SHALL validate that the Project exists and has status `approved` before proceeding
2. IF a publish is triggered for a Project that is not `approved`, THEN THE Control_Plane SHALL reject the publish with an error indicating the Project is not eligible
3. WHEN a publish is validated, THE Publish_Flow SHALL read the Repo_Config from the registered repository
4. WHEN the Repo_Config is read successfully, THE Publish_Flow SHALL build the static site from the Markdown content and Nav_Config
5. WHEN the site build succeeds, THE Publish_Flow SHALL upload all built artifacts to R2 under stable paths keyed by the Project Slug
6. WHEN the artifact upload to R2 completes successfully, THE Publish_Flow SHALL activate the new content as the live served version for that Project
7. IF the artifact upload to R2 fails or is incomplete, THEN THE Publish_Flow SHALL not activate the partial upload and SHALL preserve the previously live content
8. WHEN artifacts are successfully uploaded, THE Publish_Flow SHALL replace the Repo_Derived_Entry set for that Project in D1 with the entries declared in the current Allowed_List
9. WHEN the Repo_Derived_Entry set changes, THE Publish_Flow SHALL reconcile the Cloudflare access configuration for that Project
10. WHEN neither the access configuration nor the Allowed_List has changed, THE Publish_Flow SHALL skip the D1 access sync and Cloudflare reconciliation steps

### Requirement 4: Access Modes

**User Story:** As a platform administrator, I want to assign an access mode to each project, so that public projects are freely readable and password-protected projects require authentication.

#### Acceptance Criteria

1. THE Platform SHALL support the access modes `public` and `password` in phase 1
2. WHILE a Project has Access_Mode `public`, THE Worker SHALL serve content for that Project without requiring any authentication
3. WHILE a Project has Access_Mode `password`, THE Worker SHALL require a valid Session_Token before serving content for that Project
4. THE Platform SHALL enforce that each Project has exactly one Access_Mode
5. THE Platform SHALL treat Access_Mode as immutable after Project registration

### Requirement 5: Password Authentication Flow

**User Story:** As a documentation consumer, I want to authenticate with a project password to access protected documentation, so that I can view content that is not publicly available.

#### Acceptance Criteria

1. WHEN an unauthenticated request arrives for a Project with Access_Mode `password`, THE Worker SHALL return a login page displaying the Project title
2. WHEN a user submits a password on the login page, THE Worker SHALL verify the submitted password against the Password_Hash stored in D1 using scrypt
3. WHEN the password verification succeeds, THE Worker SHALL issue a Session_Token as a secure cookie scoped to that Project and redirect the user to the originally requested path
4. IF the password verification fails, THEN THE Worker SHALL re-render the login page with an error indication and SHALL not issue a Session_Token
5. WHEN a request includes a Session_Token cookie, THE Worker SHALL validate the token by verifying the HMAC signature and checking that the token has not expired
6. IF a Session_Token is expired or has an invalid HMAC signature, THEN THE Worker SHALL treat the request as unauthenticated and return the login page
7. THE Platform SHALL store only the scrypt-derived Password_Hash in D1 and SHALL never store the plaintext password
8. THE Worker SHALL never include protected content in any response before successful authentication
9. WHEN a Project's Password_Hash is updated in D1, all existing Session_Tokens for that Project SHALL be invalidated immediately by including a password-version identifier in the token payload and rejecting tokens whose password-version does not match the current version stored in D1
10. THE Worker SHALL enforce rate limiting on the password login endpoint to mitigate brute-force attacks — after a configurable number of consecutive failed attempts for a given Project within a time window, THE Worker SHALL temporarily reject further login attempts with an HTTP 429 response
11. THE Worker SHALL log each failed login attempt with the Project Slug and request metadata (excluding the submitted password) for operational visibility

### Requirement 6: Session Token Management

**User Story:** As a platform operator, I want session tokens to be secure, time-limited, and project-scoped, so that access grants are properly isolated and expire automatically.

#### Acceptance Criteria

1. THE Worker SHALL generate Session_Tokens in the format `base64url(payload).base64url(signature)` using HMAC signing
2. THE Worker SHALL scope each Session_Token to a single Project so that a token for one Project does not grant access to any other Project
3. THE Platform SHALL support a configurable session duration at the platform level with a default of 8 hours
4. WHEN a Session_Token's age exceeds the configured session duration, THE Worker SHALL treat the token as expired and require re-authentication
5. THE Worker SHALL set Session_Token cookies with the `Secure`, `HttpOnly`, and `SameSite` attributes
6. THE Session_Token payload SHALL contain at minimum the following fields: a token version identifier, the Project Slug or project ID, an issued-at timestamp, an expiry timestamp, and a password-version identifier corresponding to the current Password_Hash version at time of issuance
7. THE Worker SHALL reject any Session_Token whose token version is not recognized or whose password-version does not match the current password-version stored in D1 for that Project

### Requirement 7: Access Policy Layered Evaluation

**User Story:** As a platform administrator, I want a layered access policy system where deny rules always win and admin overrides take precedence over repository declarations, so that I maintain authoritative control over who can access what.

#### Acceptance Criteria

1. THE Access_Policy_Engine SHALL evaluate access in the following precedence order: platform blacklist, platform whitelist, project blacklist, project whitelist, Repo_Derived_Entry allow list, default deny
2. WHEN any deny rule (platform blacklist or project blacklist) matches a subject, THE Access_Policy_Engine SHALL deny access regardless of any allow rules at lower precedence levels
3. WHEN a platform whitelist entry matches a subject and no deny rule applies, THE Access_Policy_Engine SHALL grant access to all projects
4. WHEN a project whitelist entry matches a subject and no deny rule applies, THE Access_Policy_Engine SHALL grant access to that specific Project
5. WHEN a Repo_Derived_Entry matches a subject and no deny rule or higher-precedence rule overrides the result, THE Access_Policy_Engine SHALL grant access to that specific Project
6. WHEN no rule matches a subject, THE Access_Policy_Engine SHALL deny access by default
7. THE Platform SHALL support subject matching by exact email address and by domain wildcard pattern (e.g. `*@example.com`)
8. THE Access_Policy_Engine SHALL govern identity-based access modes only (future `invite_list`); for Projects with Access_Mode `password`, the layered policy evaluation does not apply at request time — password verification alone controls access
9. FOR Projects with Access_Mode `public`, THE Access_Policy_Engine SHALL not be invoked — content is served without identity evaluation

### Requirement 8: Repository Access Declarations

**User Story:** As a project owner, I want to declare who should have access to my project's documentation via my repository config, so that I can manage my intended sharing list alongside my content.

#### Acceptance Criteria

1. THE Platform SHALL accept access declarations from a repository's Allowed_List file containing email addresses and domain wildcard patterns
2. THE Platform SHALL restrict repository-originated access declarations to `allow` effect only — repositories SHALL not declare `deny` rules
3. THE Platform SHALL scope repository-originated access declarations to the repository's own bound Project only
4. IF a repository attempts to declare access rules for a Project other than its own bound Project, THEN THE Publish_Flow SHALL reject those declarations and log the violation
5. WHEN a publish occurs, THE Publish_Flow SHALL replace the entire set of Repo_Derived_Entries for that Project with the entries from the current Allowed_List
6. WHEN a publish replaces Repo_Derived_Entries, THE Publish_Flow SHALL preserve all Admin_Override entries for that Project
7. WHEN a repository publishes an empty or absent Allowed_List, THE Publish_Flow SHALL remove all prior Repo_Derived_Entries for that Project

### Requirement 9: Admin Policy Overrides

**User Story:** As a platform administrator, I want to manage platform-wide and project-specific allow/deny overrides, so that I can enforce organizational access policies that take precedence over repository declarations.

#### Acceptance Criteria

1. THE Control_Plane SHALL support creating Admin_Override entries at platform scope (affecting all projects) and at project scope (affecting a single Project)
2. THE Control_Plane SHALL support Admin_Override entries with `allow` or `deny` effect
3. THE Control_Plane SHALL support Admin_Override entries targeting subjects by exact email address or domain wildcard pattern
4. WHEN an Admin_Override is created or modified, THE Control_Plane SHALL persist the entry in D1 and reconcile the Cloudflare access configuration promptly
5. THE Publish_Flow SHALL never modify or remove Admin_Override entries during a publish operation

### Requirement 10: Repository Config Contract

**User Story:** As a project owner, I want a clear and simple repository file structure for my project configuration, so that I can manage my documentation project entirely from my repository.

#### Acceptance Criteria

1. THE Platform SHALL require each project repository to contain a `project.yml` file declaring: slug, title, description, publish enabled flag, and Access_Mode
2. THE Platform SHALL require each project repository to contain a `nav.yml` file defining the explicit navigation hierarchy including page labels, order, and section layout
3. THE Platform SHALL support an optional `allowed-list.yml` file in the repository root for declaring project-local access allow rules
4. THE Platform SHALL require all Markdown content pages to reside under a `/content` directory in the repository
5. WHEN the Publish_Flow reads Repo_Config, THE Publish_Flow SHALL validate that the declared Slug matches the registered Slug for that Project
6. IF the Repo_Config declares a Slug that does not match the registered Slug, THEN THE Publish_Flow SHALL reject the publish with an error

### Requirement 11: Content Format and Page Metadata

**User Story:** As a documentation author, I want to write Markdown pages with simple metadata, so that I can control page titles, ordering, and section grouping without complex tooling.

#### Acceptance Criteria

1. THE Platform SHALL render documentation pages from Markdown files located under the `/content` directory
2. THE Platform SHALL require each Markdown page to declare `title` and `order` metadata
3. THE Platform SHALL support optional page metadata fields: `section`, `hidden`, `template`, and `tags`
4. WHEN a Markdown page declares `hidden` as true, THE Platform SHALL exclude that page from the rendered navigation but SHALL still serve the page if requested by direct URL
5. THE Platform SHALL use a single standard template for all pages in phase 1
6. THE Platform SHALL derive the navigation menu from the Nav_Config file, not from filesystem directory discovery

### Requirement 12: Navigation Configuration

**User Story:** As a documentation author, I want to define my site's navigation structure explicitly in a config file, so that I have full control over page hierarchy, ordering, and section grouping.

#### Acceptance Criteria

1. THE Platform SHALL read navigation structure from the `nav.yml` file in the project repository
2. THE Nav_Config SHALL define page hierarchy, display labels, page order, and section grouping
3. WHEN the Publish_Flow builds the site, THE Publish_Flow SHALL generate navigation markup according to the Nav_Config
4. IF a page referenced in Nav_Config does not exist in the `/content` directory, THEN THE Publish_Flow SHALL report a validation error for the missing page

### Requirement 13: R2 Content Storage

**User Story:** As a platform operator, I want built site artifacts stored under stable paths in R2, so that project URLs remain fixed across publishes without version-segment indirection.

#### Acceptance Criteria

1. THE Publish_Flow SHALL upload built artifacts to R2 using stable paths keyed by the Project Slug without build ID or version indirection in the public-facing path
2. THE Worker SHALL serve content for a Project by reading artifacts from R2 at the path indicated by the Project's current active publish pointer
3. THE Platform SHALL not require public URL changes when a new version of a Project is published

### Requirement 14: D1 as System of Record

**User Story:** As a platform operator, I want D1 (Cloudflare SQLite) to be the single authoritative system of record for all project state and access policy, so that the platform has a consistent and reliable source of truth.

#### Acceptance Criteria

1. THE Platform SHALL store all project records, access policy entries, Admin_Overrides, Repo_Derived_Entries, and operational records in D1
2. THE Platform SHALL treat D1 as the authoritative source of truth for Effective_State, taking precedence over Repo_Config when they diverge
3. WHEN Repo_Config changes without a publish occurring, THE Platform SHALL not update D1 state
4. THE Platform SHALL store operational records in D1 for: project registration, project approval/disable actions, publish attempts, and publish success/failure outcomes

### Requirement 15: Cloudflare Access Reconciliation

**User Story:** As a platform operator, I want the platform to reconcile Cloudflare access configuration from D1 state, so that the enforcement layer stays consistent with the authoritative policy without manual intervention.

#### Acceptance Criteria

1. THE Platform SHALL treat Cloudflare Access as the enforcement layer and D1 as the authoritative source of access policy
2. WHEN an Admin_Override is created or modified, THE Control_Plane SHALL reconcile the corresponding Cloudflare access configuration promptly
3. WHEN a publish changes the Repo_Derived_Entry set for a Project, THE Publish_Flow SHALL reconcile the Cloudflare access configuration for that Project
4. WHEN a Project has Access_Mode `public`, THE Platform SHALL not apply a Cloudflare Access gate to that Project's path
5. WHEN a Project has Access_Mode `password`, THE Worker SHALL handle authentication directly without depending on Cloudflare Access

### Requirement 16: Safe Activation and Publish Atomicity

**User Story:** As a platform operator, I want publishes to go live only after all artifacts are successfully uploaded, so that users never see incomplete or broken documentation.

#### Acceptance Criteria

1. THE Publish_Flow SHALL upload new artifacts to a staging prefix or temporary path in R2 that is not served to users
2. WHEN the complete artifact upload to the staging location succeeds, THE Publish_Flow SHALL atomically update the Project's active publish pointer in D1 to reference the new artifact set
3. THE Worker SHALL resolve content paths using the Project's active publish pointer so that the cutover from old to new content is a single pointer change, not a gradual overwrite
4. IF any step of the artifact upload fails, THEN THE Publish_Flow SHALL preserve the previous active publish pointer and previously live content, and SHALL report the failure
5. THE Publish_Flow SHALL record the outcome of each publish attempt (success or failure) as an operational record in D1
6. WHEN a publish fails after partial artifact upload, THE Publish_Flow SHALL ensure the partial staged artifacts are not referenced by the active publish pointer and are not served to users
7. THE Publish_Flow SHALL clean up orphaned staging artifacts from R2 after a failed publish or after a successful publish replaces the previous artifact set

### Requirement 17: GitHub Actions Integration

**User Story:** As a project owner, I want a GitHub Actions workflow in my repository that triggers the build and publish process, so that publishing is automated on deployment events.

#### Acceptance Criteria

1. THE Platform SHALL provide a GitHub_Actions_Workflow definition (a `.github/workflows` YAML file) that project repositories include to trigger the publish process
2. WHEN the GitHub_Actions_Workflow executes, THE workflow SHALL check out the repository source and invoke the Control_Plane publish endpoint, passing the repository identity and any required authentication credentials
3. THE Control_Plane SHALL be the sole build authority — WHEN a publish is triggered, THE Control_Plane SHALL read the repository content, build the static site, and upload artifacts to R2
4. THE GitHub_Actions_Workflow SHALL authenticate with the Control_Plane using a project-specific or platform-level secret to prove the request originates from an authorized repository

### Requirement 18: Platform Abstraction for Future Expansion

**User Story:** As a platform architect, I want the architecture to abstract platform-specific integrations behind clean interfaces, so that the system can expand to additional platforms beyond Cloudflare in the future.

#### Acceptance Criteria

1. THE Platform SHALL abstract storage operations (R2) behind a storage interface so that alternative storage backends can be substituted without modifying core logic
2. THE Platform SHALL abstract access enforcement operations (Cloudflare Access) behind an enforcement interface so that alternative enforcement mechanisms can be substituted
3. THE Platform SHALL abstract database operations (D1) behind a data access interface so that alternative databases can be substituted

### Requirement 19: Operational Auditability

**User Story:** As a platform administrator, I want operational records for key platform events, so that I can troubleshoot issues and understand platform activity.

#### Acceptance Criteria

1. THE Platform SHALL record an operational entry in D1 for each project registration event
2. THE Platform SHALL record an operational entry in D1 for each project approval, disable, or delete action
3. THE Platform SHALL record an operational entry in D1 for each publish attempt, including whether the attempt succeeded or failed
4. IF a publish fails, THEN THE Platform SHALL include a reason or error context in the operational record

### Requirement 20: Cache Invalidation After Publish

**User Story:** As a platform operator, I want new content to become visible to users promptly after a successful publish, so that stale cached responses do not persist beyond a defined freshness window.

#### Acceptance Criteria

1. WHEN a publish completes successfully, THE Platform SHALL ensure that new content is served to users within a defined freshness window
2. THE Worker SHALL set appropriate `Cache-Control` headers on content responses so that edge and browser caches respect the platform's freshness policy
3. THE Platform SHALL support a configurable cache TTL at the platform level to control how quickly new content replaces cached old content after a publish

### Requirement 21: Project Deletion R2 Cleanup

**User Story:** As a platform operator, I want project deletion to remove both D1 state and R2 artifacts, so that no orphaned content remains after a project is removed.

#### Acceptance Criteria

1. WHEN an administrator deletes a Project, THE Control_Plane SHALL remove all R2 artifacts associated with that Project in addition to removing the Project record and associated state from D1
2. IF R2 artifact cleanup fails during deletion, THEN THE Control_Plane SHALL log the failure and report it as a partial deletion requiring manual cleanup
3. THE Control_Plane SHALL remove the Cloudflare access configuration for the deleted Project's path as part of the deletion process

### Requirement 22: Control Plane Authentication

**User Story:** As a platform operator, I want the control plane admin API to be protected by authentication, so that only authorized administrators can register projects, manage lifecycle states, and configure access overrides.

#### Acceptance Criteria

1. THE Control_Plane SHALL require authentication on all admin API endpoints including project registration, approval, disable, delete, and Admin_Override management
2. THE Control_Plane SHALL support API key-based authentication in phase 1, where each request must include a valid API key
3. IF a request to the Control_Plane lacks valid authentication credentials, THEN THE Control_Plane SHALL reject the request with HTTP 401
4. THE Platform SHALL store API keys securely and SHALL not log or expose them in operational records or error responses
