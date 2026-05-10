/**
 * Homepage handler — serves the nrdocs landing page at /.
 */

import type { Env } from '../index.js';
import { NRDOCS_VERSION } from '@nrdocs/shared';

export function handleHomepage(_request: Request, env: Env): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="nrdocs — serverless docs publishing for private GitHub repos. Protected-first, operator-controlled.">
  <meta name="generator" content="nrdocs ${NRDOCS_VERSION}">
  <title>nrdocs — Keep docs with the code</title>
  <style>
    :root {
      --bg: #f7f7f4;
      --surface: #ffffff;
      --surface-alt: #efefe9;
      --text: #171717;
      --muted: #686860;
      --line: #deded6;
      --accent: #1f6feb;
      --accent-dark: #174ea6;
      --code-bg: #202124;
      --code-text: #f5f5f0;
      --max: 1120px;
      --radius: 18px;
      --shadow: 0 18px 50px rgba(20, 20, 20, 0.08);
    }
    *{box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);line-height:1.6;-webkit-font-smoothing:antialiased}
    a{color:inherit;text-decoration:none}
    .site-header{position:sticky;top:0;z-index:20;border-bottom:1px solid rgba(222,222,214,0.8);background:rgba(247,247,244,0.88);backdrop-filter:blur(16px)}
    .nav{max-width:var(--max);margin:0 auto;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;gap:24px}
    .brand{display:inline-flex;align-items:center;gap:10px;font-weight:720;letter-spacing:-0.03em;font-size:20px}
    .brand-mark{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--text);color:var(--surface);font-size:14px;font-weight:800;letter-spacing:-0.05em}
    .nav-links{display:flex;align-items:center;gap:22px;color:var(--muted);font-size:14px;font-weight:560}
    .nav-links a:hover{color:var(--text)}
    .container{max-width:var(--max);margin:0 auto;padding:0 24px}
    .hero{padding:86px 0 64px;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(320px,0.95fr);gap:54px;align-items:center}
    .eyebrow{display:inline-flex;align-items:center;gap:8px;padding:7px 11px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--muted);font-size:13px;font-weight:620;margin-bottom:22px}
    .eyebrow span{width:7px;height:7px;border-radius:999px;background:#2da44e}
    h1,h2,h3,p{margin-top:0}
    h1{font-size:clamp(46px,7vw,82px);line-height:0.94;letter-spacing:-0.075em;margin-bottom:26px}
    .hero-copy{font-size:clamp(18px,2vw,22px);color:var(--muted);max-width:660px;margin-bottom:34px}
    .hero-copy strong{color:var(--text);font-weight:720}
    .actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
    .button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 18px;border-radius:12px;font-weight:700;border:1px solid transparent;transition:transform 160ms ease,background 160ms ease}
    .button:hover{transform:translateY(-1px)}
    .button.primary{background:var(--text);color:var(--surface)}
    .button.primary:hover{background:#2c2c2c}
    .button.secondary{background:var(--surface);color:var(--text);border-color:var(--line)}
    .button.secondary:hover{border-color:#c7c7bd}
    .hero-card{background:var(--surface);border:1px solid var(--line);border-radius:26px;box-shadow:var(--shadow);overflow:hidden}
    .terminal-top{display:flex;align-items:center;gap:7px;padding:16px 18px;background:var(--surface-alt);border-bottom:1px solid var(--line)}
    .dot{width:10px;height:10px;border-radius:999px;background:#c9c9c1}
    .terminal{margin:0;background:var(--code-bg);color:var(--code-text);padding:24px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:14px;line-height:1.75;min-height:240px;overflow-x:auto;white-space:pre}
    .terminal .muted{color:#a8a8a0}
    .terminal .ok{color:#9be9a8}
    .terminal .path{color:#79c0ff}
    section{padding:68px 0}
    .section-head{max-width:760px;margin-bottom:34px}
    .section-kicker{color:var(--accent-dark);font-size:13px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px}
    h2{font-size:clamp(32px,5vw,52px);line-height:1.02;letter-spacing:-0.055em;margin-bottom:16px}
    .section-copy{color:var(--muted);font-size:18px;max-width:720px}
    .grid{display:grid;gap:18px}
    .grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
    .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:24px}
    .card h3{font-size:20px;letter-spacing:-0.03em;margin-bottom:10px}
    .card p{color:var(--muted);margin-bottom:0}
    .workflow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:28px}
    .step{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:18px;min-height:142px}
    .step-number{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:9px;background:var(--surface-alt);color:var(--muted);font-size:13px;font-weight:800;margin-bottom:18px}
    .step strong{display:block;line-height:1.25;letter-spacing:-0.02em;margin-bottom:8px}
    .step span{color:var(--muted);font-size:14px;line-height:1.45;display:block}
    .footnote{color:var(--muted);font-size:14px;text-align:center;padding:34px 24px 48px}
    @media(max-width:900px){.nav-links{display:none}.hero,.workflow{grid-template-columns:1fr}.hero{padding-top:60px}.grid.three{grid-template-columns:1fr}}
    @media(max-width:520px){.container,.nav{padding-left:18px;padding-right:18px}h1{font-size:46px}.terminal{font-size:12px;padding:18px}}
  </style>
</head>
<body>
  <header class="site-header">
    <nav class="nav">
      <a class="brand" href="/">
        <span class="brand-mark">nr</span>
        <span>nrdocs</span>
      </a>
      <div class="nav-links">
        <a href="#workflow">Workflow</a>
        <a href="#features">Features</a>
        <a href="https://github.com/noam-r/nrdocs">GitHub</a>
      </div>
    </nav>
  </header>

  <main>
    <div class="container">
      <section class="hero">
        <div>
          <div class="eyebrow"><span></span> Open-source docs publishing</div>
          <h1>Keep docs with the code. Publish only the docs.</h1>
          <p class="hero-copy">
            <strong>nrdocs</strong> publishes documentation from private GitHub repos to a serverless docs site. Docs stay with the code. Visibility is controlled by the operator. No servers required.
          </p>
          <div class="actions">
            <a class="button primary" href="https://github.com/noam-r/nrdocs">View on GitHub</a>
            <a class="button secondary" href="${env.BASE_URL}/api/status">API Status</a>
          </div>
        </div>

        <aside class="hero-card">
          <div class="terminal-top">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
          </div>
          <pre class="terminal"><span class="muted"># deploy once</span>
nrdocs deploy

<span class="muted"># repo owner</span>
nrdocs init
git push

<span class="muted"># operator approves</span>
nrdocs approve owner/repo --access public
<span class="ok">✓ docs live</span>
<span class="path">${env.BASE_URL}/owner/repo/</span></pre>
        </aside>
      </section>
    </div>

    <section id="workflow">
      <div class="container">
        <div class="section-head">
          <div class="section-kicker">Workflow</div>
          <h2>A normal Git workflow for documentation.</h2>
          <p class="section-copy">Write docs where the work happens. Push as usual. The GitHub Action publishes artifacts. An operator approves. Docs go live.</p>
        </div>

        <div class="workflow">
          <div class="step">
            <div class="step-number">1</div>
            <strong>Write docs</strong>
            <span>Markdown in the project repo, next to the code.</span>
          </div>
          <div class="step">
            <div class="step-number">2</div>
            <strong>Push</strong>
            <span>GitHub Action builds and uploads artifacts via OIDC.</span>
          </div>
          <div class="step">
            <div class="step-number">3</div>
            <strong>Approve</strong>
            <span>Operator decides: public or password-protected.</span>
          </div>
          <div class="step">
            <div class="step-number">4</div>
            <strong>Serve</strong>
            <span>Docs are live. Updates publish without re-approval.</span>
          </div>
        </div>
      </div>
    </section>

    <section id="features">
      <div class="container">
        <div class="section-head">
          <div class="section-kicker">Features</div>
          <h2>Protected-first. Serverless. Simple.</h2>
        </div>

        <div class="grid three">
          <article class="card">
            <h3>Protected by default</h3>
            <p>Nothing is public until an operator explicitly approves it. No accidental exposure.</p>
          </article>
          <article class="card">
            <h3>No servers</h3>
            <p>Runs on Cloudflare Workers, D1, and R2. No VM, no container, no maintenance.</p>
          </article>
          <article class="card">
            <h3>GitHub OIDC auth</h3>
            <p>No publish tokens to manage. Identity comes from verified GitHub Actions OIDC.</p>
          </article>
          <article class="card">
            <h3>Auto-approval rules</h3>
            <p>Trust entire namespaces or specific repos. New pushes publish without manual approval.</p>
          </article>
          <article class="card">
            <h3>Password protection</h3>
            <p>Operator-managed passwords with session cookies. No reader accounts needed.</p>
          </article>
          <article class="card">
            <h3>Markdown-first</h3>
            <p>Write Markdown. Get a docs site. No build tools, no config files beyond the basics.</p>
          </article>
        </div>
      </div>
    </section>
  </main>

  <footer class="footnote">
    <p>nrdocs v${NRDOCS_VERSION} &middot; docs should move with the work, not chase it around.</p>
  </footer>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
