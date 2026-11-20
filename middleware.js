// Vercel Routing Middleware: a login in front of the whole site, api/ included.
// Username is PEDALA_USER (default "admin"), password is PEDALA_PASSWORD, both set in
// Vercel → Project → Settings → Environment Variables. Without a password nobody gets in.
// More people, each with their own data: PEDALA_USER2 / PEDALA_PASSWORD2 … up to 5 (see lib/session.js).
// Their session cookie is "<user>.<token>", plus a readable pedala_ns=<name> that tells the app which local
// storage to use on the device.
// A successful login leaves a signed cookie for a year, so the installed app does not ask again
// after it is closed. Changing PEDALA_PASSWORD logs every device out.
// The login page is in Croatian for browsers set to Croatian (or a close language), in English otherwise.
export const config = { matcher: "/:path*" };

/* Chrome fetches these without the login when it installs the app, and they hold nothing private */
const PUBLIC = /^\/(manifest\.webmanifest|sw\.js|icons\/[\w.-]+\.png)$/;
const COOKIE = "pedala_session", NS = "pedala_ns", YEAR = 365 * 24 * 3600;
function users(){
  const out = [{ n: 1, user: process.env.PEDALA_USER || "admin", pass: process.env.PEDALA_PASSWORD }];
  for(let n = 2; n <= 5; n++) if(process.env["PEDALA_USER" + n] && process.env["PEDALA_PASSWORD" + n])
    out.push({ n, user: process.env["PEDALA_USER" + n], pass: process.env["PEDALA_PASSWORD" + n] });
  return out;
}
const slug = user => String(user).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || "x";
const sessionCookies = (u, token) => [`${COOKIE}=${encodeURIComponent(u.user)}.${token}; Path=/; Max-Age=${YEAR}; HttpOnly; Secure; SameSite=Lax`,
  u.n === 1 ? `${NS}=; Path=/; Max-Age=0; Secure; SameSite=Lax` : `${NS}=${slug(u.user)}; Path=/; Max-Age=${YEAR}; Secure; SameSite=Lax`];
/* the logged-in user, or null */
async function sessionUser(request, all){
  const c = cookie(request, COOKIE), i = c.lastIndexOf(".");
  if(i < 0){ const main = all[0]; return c && same(c, await sign(main.user, main.pass)) ? main : null; }   // a session from before profiles
  let name; try{ name = decodeURIComponent(c.slice(0, i)); }catch{ return null; }
  const u = all.find(x => x.user === name);
  return u && same(c.slice(i + 1), await sign(u.user, u.pass)) ? u : null;
}

export default async function middleware(request){
  const url = new URL(request.url);
  if(PUBLIC.test(url.pathname)) return;
  const all = users(), hr = croatian(request);
  if(!all[0].pass) return text(hr ? "Prijava nije postavljena: na Vercelu dodaj PEDALA_PASSWORD i napravi Redeploy." : "Login is not set up: add PEDALA_PASSWORD on Vercel and redeploy.", 503);
  if(url.pathname === "/__login" && request.method === "POST"){
    let f; try{ f = await request.formData(); }catch{ f = new FormData(); }
    const next = safePath(f.get("next")), name = String(f.get("user") || "").trim(), password = String(f.get("password") || "");
    let ok = null; for(const u of all) if(same(name, u.user) & same(password, u.pass)) ok = u;   // check every profile, so timing says nothing
    if(ok) return redirect(next, sessionCookies(ok, await sign(ok.user, ok.pass)));
    return redirect(`/__login?e=1&next=${encodeURIComponent(next)}`);
  }
  if(url.pathname === "/__logout") return redirect("/", [`${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, `${NS}=; Path=/; Max-Age=0; Secure; SameSite=Lax`]);

  if(await sessionUser(request, all)) return url.pathname === "/__login" ? redirect("/") : undefined;   // undefined: carry on to the site

  if(request.method === "GET" && (request.headers.get("accept") || "").includes("text/html")){
    const login = url.pathname === "/__login";
    return loginPage(login ? safePath(url.searchParams.get("next")) : url.pathname + url.search, login && url.searchParams.get("e") === "1", hr);
  }
  return new Response(JSON.stringify({ error: hr ? "Potrebna je prijava" : "Login required" }), { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/* session token: HMAC of the username keyed by the password, so a new password invalidates it */
async function sign(user, pass){
  const enc = new TextEncoder(), key = await crypto.subtle.importKey("raw", enc.encode(pass), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode("pedala-session:" + user)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function cookie(request, name){
  for(const part of (request.headers.get("cookie") || "").split(/;\s*/)){ const i = part.indexOf("="); if(part.slice(0, i) === name) return part.slice(i + 1); }
  return "";
}
const croatian = request => /^(hr|bs|sr|sh)\b/i.test(request.headers.get("accept-language") || "");
const safePath = p => typeof p === "string" && p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/__") ? p : "/";
function redirect(location, setCookies){
  const h = new Headers({ location, "cache-control": "no-store" });
  for(const c of [].concat(setCookies || [])) h.append("set-cookie", c);
  return new Response(null, { status: 303, headers: h });
}
const text = (body, status) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* compare without leaking how many leading characters matched */
function same(a, b){
  let d = a.length ^ b.length;
  for(let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

function loginPage(next, failed, hr){
  const t = (h, e) => hr ? h : e;
  return new Response(`<!doctype html>
<html lang="${t("hr", "en")}" translate="no"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#151b26"><title>Pedala · ${t("prijava", "login")}</title>
<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" type="image/png" href="/icons/icon-192.png">
<style>
:root{--bg:#151b26;--panel:#1f2735;--line:#2f3a4d;--text:#e9edf3;--muted:#8b97aa;--z3:#2fbf71;--z6:#e5484d}
*{box-sizing:border-box} html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font:400 16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
body{display:grid;place-items:center;padding:16px}
form{width:min(360px,100%);background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:24px 22px}
img{width:56px;height:56px;border-radius:14px;display:block;margin-bottom:12px}
h1{font-size:26px;margin:0 0 4px} p{margin:0 0 18px;color:var(--muted)}
label{display:block;font-size:14px;color:var(--muted);margin-bottom:12px}
input{display:block;width:100%;margin-top:5px;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:11px 12px;color:var(--text);font:inherit}
input:focus{outline:2px solid #3d8bfd;outline-offset:1px}
button{width:100%;margin-top:6px;border:0;border-radius:12px;padding:12px;background:var(--text);color:var(--bg);font-family:inherit;font-size:16px;font-weight:600;cursor:pointer}
.err{color:var(--z6);margin:-6px 0 12px;font-size:14px}
</style></head><body>
<form method="post" action="/__login">
  <img src="/icons/icon-192.png" alt="">
  <h1>Pedala</h1><p>${t("Prijavi se. Ovaj uređaj ostaje prijavljen godinu dana.", "Log in. This device stays logged in for a year.")}</p>
  ${failed ? `<div class="err" role="alert">${t("Krivo ime ili lozinka.", "Wrong username or password.")}</div>` : ""}
  <input type="hidden" name="next" value="${esc(next)}">
  <label>${t("Korisničko ime", "Username")}<input name="user" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus></label>
  <label>${t("Lozinka", "Password")}<input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit">${t("Prijava", "Log in")}</button>
</form></body></html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
