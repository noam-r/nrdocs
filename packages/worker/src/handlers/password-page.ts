/**
 * Renders the password prompt page for protected docs.
 * Minimal HTML — no repo metadata beyond what's in the URL.
 */

export function renderPasswordPage(repoFullName: string, error?: string): Response {
  const errorHtml = error
    ? `<p class="error" role="alert">${escapeHtml(error)}</p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Password Required</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #f5f5f5;
      color: #333;
    }
    .container {
      background: #fff;
      border-radius: 8px;
      padding: 2rem;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      width: 100%;
      max-width: 400px;
    }
    h1 { font-size: 1.25rem; margin-bottom: 1rem; }
    label { display: block; font-size: 0.875rem; margin-bottom: 0.5rem; font-weight: 500; }
    input[type="password"] {
      width: 100%;
      padding: 0.5rem 0.75rem;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 1rem;
      margin-bottom: 1rem;
    }
    input[type="password"]:focus {
      outline: 2px solid #0066cc;
      outline-offset: 1px;
      border-color: #0066cc;
    }
    button {
      width: 100%;
      padding: 0.625rem;
      background: #0066cc;
      color: #fff;
      border: none;
      border-radius: 4px;
      font-size: 1rem;
      cursor: pointer;
    }
    button:hover { background: #0052a3; }
    button:focus { outline: 2px solid #0066cc; outline-offset: 2px; }
    .error { color: #cc0000; font-size: 0.875rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <main class="container">
    <h1>Password Required</h1>
    ${errorHtml}
    <form method="POST" action="/_nrdocs/login">
      <input type="hidden" name="repo" value="${escapeHtml(repoFullName)}">
      <label for="password">Enter password to view documentation</label>
      <input type="password" id="password" name="password" required autocomplete="current-password">
      <button type="submit">Submit</button>
    </form>
  </main>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Escape HTML special characters to prevent XSS. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
