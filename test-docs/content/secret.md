# Secret Page

This is a secret page that only authenticated users can see.

## Confidential information

- The password is hashed with PBKDF2-SHA256 and stored in D1
- Session tokens are HMAC-signed and scoped to this project
- Changing the password invalidates all existing sessions immediately
