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
  <meta name="description" content="nrdocs publishes documentation from GitHub repos without exposing the repository. Public or password-protected docs from any repo.">
  <meta name="generator" content="nrdocs ${NRDOCS_VERSION}">
  <title>nrdocs — Publish docs without exposing the repo</title>
  <style>
    :root{--bg:#f7f7f4;--surface:#fff;--surface-alt:#efefe9;--text:#171717;--muted:#686860;--line:#deded6;--accent:#1f6feb;--accent-dark:#174ea6;--code-bg:#202124;--code-text:#f5f5f0;--max:1120px;--radius:18px;--shadow:0 18px 50px rgba(20,20,20,0.08)}
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
    h1{font-size:clamp(46px,7vw,72px);line-height:0.96;letter-spacing:-0.06em;margin-bottom:26px}
    .hero-copy{font-size:clamp(18px,2vw,21px);color:var(--muted);max-width:660px;margin-bottom:34px}
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
    .terminal{margin:0;background:var(--code-bg);color:var(--code-text);padding:24px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:14px;line-height:1.75;min-height:220px;overflow-x:auto;white-space:pre}
    .terminal .muted{color:#a8a8a0}
    .terminal .ok{color:#9be9a8}
    .terminal .path{color:#79c0ff}
    section{padding:68px 0}
    .section-head{max-width:760px;margin-bottom:34px}
    .section-kicker{color:var(--accent-dark);font-size:13px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px}
    h2{font-size:clamp(32px,5vw,48px);line-height:1.05;letter-spacing:-0.05em;margin-bottom:16px}
    .section-copy{color:var(--muted);font-size:18px;max-width:720px}
    .grid{display:grid;gap:18px}
    .grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
    .grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
    .grid.four{grid-template-columns:repeat(4,minmax(0,1fr))}
    .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:24px}
    .card h3{font-size:20px;letter-spacing:-0.03em;margin-bottom:10px}
    .card p{color:var(--muted);margin-bottom:0}
    .problem-list{margin:1.2rem 0 0;padding-left:1.2rem;color:var(--muted);line-height:1.7}
    .problem-list li{margin-bottom:0.3rem}
    .compare{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:28px}
    .compare-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:24px}
    .compare-card h3{font-size:16px;margin-bottom:12px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.04em}
    .compare-card pre{background:var(--surface-alt);border-radius:10px;padding:16px;font-size:13px;line-height:1.7;margin:0;white-space:pre;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:var(--text)}
    .workflow{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-top:28px}
    .step{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:18px;min-height:130px}
    .step-number{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:9px;background:var(--surface-alt);color:var(--muted);font-size:13px;font-weight:800;margin-bottom:14px}
    .step strong{display:block;line-height:1.25;letter-spacing:-0.02em;margin-bottom:6px}
    .step span{color:var(--muted);font-size:14px;line-height:1.45;display:block}
    .callout{background:var(--text);color:var(--surface);border-radius:28px;padding:44px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:28px;align-items:center;margin-top:48px}
    .callout h2{color:var(--surface);margin-bottom:12px}
    .callout p{color:#d6d6cf;max-width:680px;margin-bottom:0;font-size:18px}
    .callout .button{background:var(--surface);color:var(--text);white-space:nowrap}
    .status-badge{display:inline-block;padding:5px 10px;border-radius:8px;background:var(--surface-alt);border:1px solid var(--line);font-size:13px;font-weight:600;color:var(--muted);margin-top:12px}
    .footnote{color:var(--muted);font-size:14px;text-align:center;padding:34px 24px 48px}
    @media(max-width:900px){.nav-links{display:none}.hero,.compare,.callout{grid-template-columns:1fr}.grid.two,.grid.three,.grid.four,.workflow{grid-template-columns:1fr}.hero{padding-top:60px}.callout{padding:32px}}
    @media(max-width:520px){.container,.nav{padding-left:18px;padding-right:18px}h1{font-size:42px}.terminal{font-size:12px;padding:18px}.callout{padding:24px}}
  </style>
</head>
<body>
  <header class="site-header">
    <nav class="nav">
      <a class="brand" href="/"><span class="brand-mark">nr</span><span>nrdocs</span></a>
      <div class="nav-links">
        <a href="#problem">Problem</a>
        <a href="#workflow">Workflow</a>
        <a href="#use-cases">Use cases</a>
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
          <h1>Publish docs without exposing the repo.</h1>
          <p class="hero-copy">
            <strong>nrdocs</strong> lets teams keep documentation next to the code, then publish only the generated docs site. Use it for public docs from private repos, password-protected docs, or many small docs sites under one shared domain.
          </p>
          <p class="hero-copy" style="font-size:0.95em;margin-bottom:28px">Works with public and private GitHub repositories. Especially useful when the docs need a different visibility policy than the code.</p>
          <div class="actions">
            <a class="button primary" href="https://github.com/noam-r/nrdocs">View on GitHub</a>
            <a class="button secondary" href="https://github.com/noam-r/nrdocs#quick-start">Setup guide</a>
          </div>
        </div>
        <aside class="hero-card">
          <div class="terminal-top"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
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

    <section id="problem">
      <div class="container">
        <div class="section-head">
          <div class="section-kicker">The problem</div>
          <h2>GitHub Pages couples docs to repo visibility.</h2>
          <p class="section-copy">You have a repo where the code must stay private, but the docs should be easy to publish. The usual options are awkward:</p>
          <ul class="problem-list">
            <li>Make the repo public</li>
            <li>Create and maintain a second public docs repo</li>
            <li>Use enterprise-only private Pages access</li>
            <li>Give readers access to the source repo</li>
          </ul>
          <p class="section-copy" style="margin-top:1.2rem"><strong>nrdocs gives you a cleaner option:</strong> keep docs in the repo, publish only the docs output.</p>
        </div>

        <div class="compare">
          <div class="compare-card">
            <h3>Without nrdocs</h3>
            <pre>private repo
  ↓ copy docs manually
public docs repo
  ↓ GitHub Pages
public docs site</pre>
          </div>
          <div class="compare-card">
            <h3>With nrdocs</h3>
            <pre>any repo (public or private)
  ↓ git push
nrdocs (GitHub Actions + OIDC)
  ↓
public or protected docs site</pre>
          </div>
        </div>
      </div>
    </section>

    <section id="workflow">
      <div class="container">
        <div class="section-head">
          <div class="section-kicker">How it works</div>
          <h2>A normal Git workflow for documentation.</h2>
          <p class="section-copy">An operator deploys nrdocs once. Repo owners initialize docs publishing. GitHub Actions publishes via OIDC. The operator approves. Readers get a clean docs URL. Future pushes update automatically.</p>
        </div>
        <div class="workflow">
          <div class="step"><div class="step-number">1</div><strong>Deploy once</strong><span>Operator runs nrdocs deploy on Cloudflare.</span></div>
          <div class="step"><div class="step-number">2</div><strong>Init</strong><span>Repo owner runs nrdocs init. Adds Markdown docs.</span></div>
          <div class="step"><div class="step-number">3</div><strong>Push</strong><span>GitHub Action registers and publishes docs via OIDC.</span></div>
          <div class="step"><div class="step-number">4</div><strong>Approve</strong><span>Operator decides: public or password-protected.</span></div>
          <div class="step"><div class="step-number">5</div><strong>Live</strong><span>Docs served. Updates publish without re-approval.</span></div>
        </div>
      </div>
    </section>

    <section id="use-cases">
      <div class="container">
        <div class="section-head">
          <div class="section-kicker">Use cases</div>
          <h2>Use nrdocs when docs and code need different visibility.</h2>
        </div>
        <div class="grid four">
          <article class="card"><h3>Public docs from a private repo</h3><p>Keep the source private while publishing documentation for users, customers, or the community.</p></article>
          <article class="card"><h3>Password-protected internal docs</h3><p>Share docs with a small audience without giving readers access to the GitHub repository.</p></article>
          <article class="card"><h3>Same-repo documentation</h3><p>Keep docs close to the code they describe instead of copying them into a separate publishing repo.</p></article>
          <article class="card"><h3>Many sites, one platform</h3><p>Run one shared nrdocs instance and approve multiple repositories under a common docs domain.</p></article>
        </div>
      </div>
    </section>

    <section id="audience">
      <div class="container">
        <div class="section-head">
          <div class="section-kicker">Two roles</div>
          <h2>Built for repo owners and platform operators.</h2>
        </div>
        <div class="grid two">
          <article class="card">
            <h3>For repo owners</h3>
            <p>Write Markdown in your repo. Run nrdocs init. Push normally. Get a docs URL after approval. No hosting infrastructure to manage.</p>
          </article>
          <article class="card">
            <h3>For platform operators</h3>
            <p>Deploy one shared nrdocs instance. Approve which repos may publish. Choose public or password-protected access. Keep platform secrets out of project repos.</p>
          </article>
        </div>
      </div>
    </section>

    <section id="features">
      <div class="container">
        <div class="section-head">
          <div class="section-kicker">Features</div>
          <h2>Publish, protect, serve.</h2>
        </div>
        <div class="grid three">
          <article class="card"><h3>No accidental public repos</h3><p>Publish documentation without making the source repository public.</p></article>
          <article class="card"><h3>Public or password-protected</h3><p>Choose whether each docs site is open to everyone or protected by a shared password.</p></article>
          <article class="card"><h3>No publishing secrets in repos</h3><p>GitHub OIDC lets repositories publish without handing long-lived platform credentials to repo owners.</p></article>
          <article class="card"><h3>Operator approval flow</h3><p>Operators control which repositories can publish and under which access policy.</p></article>
          <article class="card"><h3>Serverless hosting</h3><p>Runs on Cloudflare Workers, D1, and R2. No VM, no container, no maintenance.</p></article>
          <article class="card"><h3>Markdown-first</h3><p>Start with simple Markdown documentation that lives next to the code.</p></article>
        </div>
      </div>
    </section>

    <section id="not">
      <div class="container">
        <div class="grid two">
          <article class="card">
            <div class="section-kicker">What nrdocs is not</div>
            <h3>Not another docs generator</h3>
            <p>MkDocs, Docusaurus, and similar tools build documentation sites. nrdocs focuses on publishing, routing, protecting, and serving docs that live in GitHub repos. Use the built-in Markdown flow for simple docs today.</p>
          </article>
          <article class="card">
            <div class="section-kicker">Project status</div>
            <h3>Early open-source release</h3>
            <p>nrdocs is an early open-source project. The current focus is making same-repo docs publishing smooth for public and private GitHub repositories.</p>
            <div class="status-badge">v${NRDOCS_VERSION} &middot; early release</div>
          </article>
        </div>
      </div>
    </section>

    <div class="container">
      <div class="callout">
        <div>
          <h2>Try nrdocs</h2>
          <p>Deploy once, initialize a repo, approve the site, and publish docs without exposing the source repository.</p>
        </div>
        <div class="actions">
          <a class="button" href="https://github.com/noam-r/nrdocs">View on GitHub</a>
        </div>
      </div>
    </div>
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
