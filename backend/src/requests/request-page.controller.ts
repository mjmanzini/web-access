import { Controller, Get, Header, Redirect } from '@nestjs/common';
import { Public } from '../auth/public.decorator';

/**
 * The child-facing "ask a parent" page.
 *
 * DNS-level blocking can't show a custom block page for HTTPS sites — the
 * browser gets a connection failure, not our HTML — so instead of intercepting,
 * we give kids a short URL they can open themselves.
 *
 * Deliberately tiny and self-contained: no auth, no data read back, no listing
 * of devices, profiles or existing requests. The only thing it can do is create
 * a pending request, which has no effect until a parent approves it in the
 * dashboard. Served outside the /api prefix so the URL stays memorable.
 */
@Controller()
export class RequestPageController {
  /**
   * Kids will type the bare hostname, not the /request path. Send them onward
   * rather than showing a 404. Only reachable on the LAN-resolved name.
   */
  @Public()
  @Get()
  @Redirect('/request', 302)
  root(): void {}

  @Public()
  @Get('request')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  // Nothing here is embeddable or scriptable from elsewhere.
  @Header('X-Frame-Options', 'DENY')
  @Header('Referrer-Policy', 'no-referrer')
  page(): string {
    return PAGE;
  }
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ask to unblock</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0f1216; color: #e8ecf1; padding: 20px;
    font: 16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  }
  .card { width: 100%; max-width: 380px; background: #161b22; border: 1px solid #232a33;
          border-radius: 14px; padding: 22px; }
  h1 { font-size: 19px; margin: 0 0 4px; }
  p.sub { margin: 0 0 18px; color: #8b98a8; font-size: 13px; }
  label { display: block; font-size: 12px; color: #8b98a8; margin: 12px 0 6px; }
  input, textarea {
    width: 100%; padding: 11px 12px; border-radius: 9px; border: 1px solid #2c343f;
    background: #0f1216; color: inherit; font: inherit;
  }
  textarea { resize: vertical; min-height: 68px; }
  button {
    width: 100%; margin-top: 18px; padding: 12px; border: 0; border-radius: 9px;
    background: #3b82f6; color: #fff; font: inherit; font-weight: 600; cursor: pointer;
  }
  button:disabled { opacity: .6; cursor: default; }
  .msg { margin-top: 14px; padding: 11px 12px; border-radius: 9px; font-size: 14px; display: none; }
  .ok { background: rgba(62,207,142,.14); color: #3ecf8e; }
  .err { background: rgba(255,92,108,.14); color: #ff5c6c; }
</style>
</head>
<body>
  <div class="card">
    <h1>Ask to unblock a site</h1>
    <p class="sub">This sends a request to your parent. Nothing unblocks until they say yes.</p>

    <form id="f">
      <label for="domain">Website address</label>
      <input id="domain" name="domain" placeholder="example.com" autocomplete="off"
             autocapitalize="none" spellcheck="false" required />

      <label for="note">Why do you need it? (optional)</label>
      <textarea id="note" name="note" maxlength="280" placeholder="It's for my homework"></textarea>

      <button type="submit" id="btn">Send request</button>
    </form>

    <div class="msg ok" id="ok">Sent. Your parent will see it on their dashboard.</div>
    <div class="msg err" id="err"></div>
  </div>

<script>
  var f = document.getElementById('f'), btn = document.getElementById('btn');
  var ok = document.getElementById('ok'), err = document.getElementById('err');

  f.addEventListener('submit', function (e) {
    e.preventDefault();
    ok.style.display = err.style.display = 'none';

    // Accept a pasted URL as well as a bare hostname.
    var raw = document.getElementById('domain').value.trim();
    var domain = raw.replace(/^[a-zA-Z]+:\\/\\//, '').split('/')[0].split('?')[0].toLowerCase();
    if (!/^[a-z0-9.-]+\\.[a-z]{2,}$/.test(domain)) {
      err.textContent = "That doesn't look like a website address.";
      err.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending…';
    fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: domain, note: document.getElementById('note').value || undefined })
    }).then(function (r) {
      if (r.ok) { f.style.display = 'none'; ok.style.display = 'block'; return; }
      err.textContent = r.status === 429
        ? 'Too many requests. Please wait a few minutes and try again.'
        : 'Could not send that request. Try again later.';
      err.style.display = 'block';
    }).catch(function () {
      err.textContent = 'No connection to the home network.';
      err.style.display = 'block';
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = 'Send request';
    });
  });
</script>
</body>
</html>`;
