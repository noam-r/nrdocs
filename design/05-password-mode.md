# Password Mode Technical Design

## Goal
Provide lightweight protection for a project using a shared password while keeping content inaccessible until the request is authorized.

## Why serverless code is still needed
Although the site content is static, password mode requires server-side logic to:
- accept password submissions
- verify the password against a stored hash
- issue a secure session
- check that session before serving protected content

In this architecture, that logic runs in a Cloudflare Worker.

## Components

### Project metadata
For a password project, the DB stores:
- project ID
- slug
- status
- access mode = `password`
- password hash
- session TTL (platform-configurable; default 8 hours)

### Worker auth endpoints
The Worker exposes logic for:
- rendering the login page
- processing password login submissions
- validating session cookies on content requests

### Session representation
After successful login, the Worker issues a secure signed session cookie.
The cookie is scoped logically to the specific project grant.

## Request flow

### First request
1. User requests `docs.example.com/project-a/...`
2. Worker parses slug `project-a`
3. Worker loads project metadata
4. Worker sees `access_mode = password`
5. Worker checks for a valid session grant for `project-a`
6. If no valid session exists, Worker returns the login page

### Login submission
1. Browser submits password to the Worker
2. Worker loads the stored password hash for `project-a`
3. Worker verifies the submitted password against the hash
4. If valid, Worker issues a secure session cookie and redirects back to the requested path
5. If invalid, Worker re-renders the login page with an error state

### Subsequent request
1. Browser retries the original page with the session cookie
2. Worker validates the session
3. If valid, Worker serves content from R2

## Security properties
- the plaintext password is never stored in content artifacts
- protected content is not publicly retrievable before authentication
- password verification occurs server-side in the Worker
- only password hashes are stored
- sessions expire automatically

## Project scoping
A password session for one project does not grant access to other projects.
