import { privateResponse } from "./http";

const escapeHtml = (value: string): string => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

// The public login page is self-contained: no dashboard assets need public access.
export const loginPage = ({
  disabled = false,
  message = "",
  status = 200,
}: {
  disabled?: boolean;
  message?: string;
  status?: number;
} = {}): Response => {
  const nonce = crypto.randomUUID();

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#0c1e39"><title>Sign in | Droplet monitoring</title>
<style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;min-height:100svh;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1a2b45;background:#f6f8fc;display:grid;grid-template-columns:42% 58%}.story{background:#0c1e39;color:#fff;padding:48px 12%;display:flex;flex-direction:column;justify-content:space-between}.brand{display:flex;align-items:center;gap:12px;font-size:25px;font-weight:650;letter-spacing:-.8px}.brand svg{color:#4b94ff}.brand small{display:block;color:#91a8c7;font-size:9px;letter-spacing:3px;margin-top:5px;font-weight:500}.story h1{font-size:42px;line-height:1.17;font-weight:550;letter-spacing:-1.7px;margin:0 0 20px}.story p{color:#9eafc8;font-size:14px;line-height:1.8;max-width:290px}.story footer{color:#7991b1;font-size:11px}.signal{display:flex;align-items:end;gap:5px;height:66px;margin:36px 0}.signal i{display:block;flex:1;max-width:9px;background:#3179e8;border-radius:3px 3px 0 0}.signal i:nth-child(3n){background:#558ff0}.signal i:nth-child(2n){height:30%}.signal i:nth-child(3n){height:55%}.signal i:nth-child(4n){height:85%}.signal i:nth-child(5n){height:45%}.signal i{height:25%}.main{display:grid;place-items:center;padding:40px 24px}.panel{width:min(100%,365px)}.eyebrow{font-size:10px;letter-spacing:1.6px;font-weight:600;color:#7186a2;margin-bottom:14px}.panel h2{font-size:30px;letter-spacing:-1px;margin:0 0 10px;font-weight:620}.intro{font-size:13px;line-height:1.7;color:#7a889d;margin:0 0 30px}label{display:block;font-size:12px;font-weight:550;margin-bottom:9px}input{width:100%;height:46px;background:white;border:1px solid #d9e2ee;border-radius:7px;padding:0 13px;font:14px inherit;color:#1a2b45;outline:none}input:focus{border-color:#2471ed;box-shadow:0 0 0 3px #2471ed20}input::placeholder{color:#a2aec0}.hint{font-size:11px;color:#91a0b5;line-height:1.6;margin:9px 0 22px}button{width:100%;height:44px;border:0;border-radius:7px;background:#2471ed;color:white;font-size:13px;font-weight:550;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:9px}button:hover{background:#1763db}button:focus-visible{outline:3px solid #7ba8f7;outline-offset:3px}button:disabled,input:disabled{opacity:.55;cursor:default}.error{font-size:12px;line-height:1.7;color:#9d4747;border:1px solid #f1d3d3;background:#fff3f3;padding:11px 13px;border-radius:7px;margin:0 0 20px}.privacy{margin-top:27px;padding-top:20px;border-top:1px solid #e2e8f1;display:flex;align-items:center;gap:7px;font-size:11px;color:#8a9ab0}.privacy svg{color:#7b9c93}.mobile-brand{display:none}@media(min-width:1500px){.story{padding:56px 15%}.story h1{font-size:50px}}@media(max-width:760px){body{display:block}.story{display:none}.main{min-height:100svh;padding:40px 25px}.mobile-brand{display:block;color:#2471ed;margin-bottom:42px;font-size:20px;font-weight:650}.panel h2{font-size:28px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
</style></head><body>
<aside class="story"><div class="brand"><svg width="27" height="32" viewBox="0 0 40 40" aria-hidden="true"><path fill="currentColor" d="M20 3C17 11 7 19 7 27a13 13 0 0 0 26 0C33 19 23 11 20 3Z"/></svg><span>droplet<small>MONITORING</small></span></div><div><div class="signal" aria-hidden="true">${"<i></i>".repeat(24)}</div><h1>Your infrastructure.<br>A clearer picture.</h1><p>CPU, memory, and disk insights for your DigitalOcean droplets, in one place.</p></div><footer>Private infrastructure monitoring</footer></aside>
<main class="main"><section class="panel" aria-labelledby="login-title"><div class="mobile-brand">droplet / monitoring</div><div class="eyebrow">YOUR WORKSPACE</div><h2 id="login-title">Welcome back</h2><p class="intro">Sign in to view your droplet insights.</p>${message ? `<p class="error" role="alert">${escapeHtml(message)}</p>` : ""}<form action="/login" method="post"><label for="api-key">API key</label><input id="api-key" name="apiKey" type="password" autocomplete="current-password" placeholder="Enter your dashboard API key" required maxlength="1024" ${disabled ? "disabled" : ""} aria-describedby="key-hint"><p class="hint" id="key-hint">Use your dashboard login key to access this workspace.</p><button type="submit" ${disabled ? "disabled" : ""}>Sign in <span aria-hidden="true">→</span></button></form><div class="privacy"><svg width="15" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z"/><path d="m8 12 3 3 5-6"/></svg>Your session expires after 12 hours.</div></section></main></body></html>`;

  return privateResponse(
    new Response(html, {
      headers: {
        "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
        "Content-Type": "text/html; charset=utf-8",
      },
      status,
    }),
  );
};
