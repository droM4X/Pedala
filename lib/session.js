// Who is logged in, for the api/ functions. middleware.js has already checked the session cookie before any api/
// call reaches a function, so here it is only read. The cookie is "<user>.<token>"; a bare token (from before
// profiles) belongs to the main user.
//
// Profiles: the main user is PEDALA_USER / PEDALA_PASSWORD; more people get PEDALA_USER2 / PEDALA_PASSWORD2 … up to 5.
// Each profile has its own data in Vercel Blob (the main user at the top, the others under u/<name>/) and its own
// intervals.icu key on Vercel: INTERVALS_API_KEY for the main user, INTERVALS_API_KEY2 … for the others.
function users(){
  const out = [{ n: 1, user: process.env.PEDALA_USER || "admin", pass: process.env.PEDALA_PASSWORD }];
  for(let n = 2; n <= 5; n++) if(process.env["PEDALA_USER" + n] && process.env["PEDALA_PASSWORD" + n])
    out.push({ n, user: process.env["PEDALA_USER" + n], pass: process.env["PEDALA_PASSWORD" + n] });
  return out;
}
const slug = user => String(user).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || "x";
function cookie(header, name){
  for(const part of String(header || "").split(/;\s*/)){ const i = part.indexOf("="); if(part.slice(0, i) === name) return part.slice(i + 1); }
  return "";
}
function profile(req){
  const all = users(), c = cookie(req?.headers?.cookie, "pedala_session"), i = c.lastIndexOf(".");
  let name = null; try{ name = i > 0 ? decodeURIComponent(c.slice(0, i)) : null; }catch{}
  const u = (name && all.find(x => x.user === name)) || all[0];
  return { n: u.n, user: u.user, prefix: u.n === 1 ? "" : `u/${slug(u.user)}/`, icuKey: process.env[u.n === 1 ? "INTERVALS_API_KEY" : "INTERVALS_API_KEY" + u.n] || null };
}
module.exports = { profile, users, slug };
