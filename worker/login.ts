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
<html class="dark" lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="darkreader-lock">
<meta name="theme-color" content="#09090b">
<title>Sign in | Droplet monitoring</title>
<style nonce="${nonce}">
:root{color-scheme:dark;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-synthesis:none;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}
body{margin:0;background:#09090b;color:#fafafa}
main{display:grid;min-height:100svh;place-items:center;padding:24px}
.panel{width:100%;max-width:384px}
.brand{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:32px;font-size:20px;font-weight:600;letter-spacing:-.5px}
.card{border:1px solid #ffffff1a;border-radius:12px;background:#18181b;padding:28px}
h1{margin:0 0 8px;font-size:24px;font-weight:600;letter-spacing:-.6px}
.intro{margin:0 0 24px;color:#a1a1aa;font-size:14px;line-height:1.5}
label{display:block;margin-bottom:8px;font-size:14px;font-weight:500}
input{width:100%;height:40px;border:1px solid #ffffff26;border-radius:6px;background:#ffffff08;padding:0 12px;color:#fafafa;font:inherit;font-size:14px}
input::placeholder{color:#a1a1aa}
input:focus-visible,button:focus-visible{outline:3px solid #71717a80;outline-offset:2px}
button{display:block;width:100%;height:40px;margin-top:20px;border:0;border-radius:6px;background:#e4e4e7;color:#18181b;font:inherit;font-size:14px;font-weight:500;cursor:pointer}
button:hover{background:#d4d4d8}
button:disabled,input:disabled{opacity:.5;cursor:default}
.error{margin:0 0 20px;border:1px solid #f8717166;border-radius:6px;padding:12px;color:#f87171;font-size:14px;line-height:1.5}
</style>
</head>
<body>
<main>
<section class="panel" aria-labelledby="login-title">
<div class="brand"><svg width="22" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M12 3c-2 4-7 8-7 12a7 7 0 0 0 14 0c0-4-5-8-7-12Z"/></svg>Droplet monitoring</div>
<div class="card">
<h1 id="login-title">Welcome back</h1>
<p class="intro">Sign in to view your droplets.</p>
${message ? `<p class="error" role="alert">${escapeHtml(message)}</p>` : ""}
<form action="/login" method="post">
<label for="api-key">API key</label>
<input id="api-key" name="apiKey" type="password" autocomplete="current-password" placeholder="Enter your dashboard API key" required maxlength="1024" ${disabled ? "disabled" : ""}>
<button type="submit" ${disabled ? "disabled" : ""}>Sign in</button>
</form>
</div>
</section>
</main>
</body>
</html>`;

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
