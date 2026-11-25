// In-memory SSE relay between the ride page and phone remote.
const os = require("node:os");

function lanLinks(host, interfaces){
  const value = String(host || ""), i = value.lastIndexOf(":"), hostname = i >= 0 ? value.slice(0, i) : value;
  const port = i >= 0 ? value.slice(i) : "";
  if(hostname && !["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return [`http://${value}/gear.html`];
  const links = [];
  for(const entries of Object.values(interfaces || {})) for(const item of entries || [])
    if(item && item.family === "IPv4" && !item.internal) links.push(`http://${item.address}${port}/gear.html`);
  return links;
}
function createRemote({ heartbeatMs = 10000, interfaces = os.networkInterfaces() } = {}){
  const state = { gear: 10, mode: "gear", bias: 1, hrOff: 0 }, rides = new Set(), phones = new Set();
  const send = (res, event, data) => { try{ res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }catch{} };
  const notify = (set, event, data) => { for(const res of set) send(res, event, data); };
  const heartbeat = setInterval(() => { const data = { t: Date.now() }; notify(rides, "ping", data); notify(phones, "ping", data); }, heartbeatMs);
  function route(req, res){
    const url = new URL(req.url, "http://localhost");
    if(!/^\/__remote(\/|$)/.test(url.pathname)) return false;
    res.setHeader("access-control-allow-origin", "*");
    if(req.method === "OPTIONS"){ res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS"); res.setHeader("access-control-allow-headers", "content-type"); res.statusCode = 204; res.end(); return true; }
    const fail = (status, body = "") => { res.statusCode = status; res.end(body); };
    if(url.pathname === "/__remote/events" && req.method === "GET"){
      const role = url.searchParams.get("role"); if(role !== "ride" && role !== "phone"){ fail(400); return true; }
      const own = role === "ride" ? rides : phones;
      res.setHeader("content-type", "text/event-stream"); res.setHeader("cache-control", "no-cache"); res.setHeader("connection", "keep-alive"); res.flushHeaders?.();
      res.write("retry: 2000\n\n"); own.add(res);
      if(role === "ride") send(res, "hello", { phones: phones.size, links: lanLinks(req.headers.host, interfaces) });
      else send(res, "hello", { ...state, ride: rides.size > 0 });
      if(role === "ride") notify(phones, "state", { ...state, ride: true });
      else notify(rides, "phones", { n: phones.size });
      req.on("close", () => { if(!own.delete(res)) return; if(role === "ride") notify(phones, "state", { ...state, ride: rides.size > 0 }); else notify(rides, "phones", { n: phones.size }); });
      return true;
    }
    if(url.pathname === "/__remote/shift" && req.method === "POST") return readBody(req, body => {
      if(!body || ![1, -1].includes(body.d)){ fail(400); return; } notify(rides, "shift", { d: body.d }); res.statusCode = 204; res.end();
    });
    if(url.pathname === "/__remote/control" && req.method === "POST") return readBody(req, body => {
      if(!body || !["start", "pause", "finish"].includes(body.a)){ fail(400); return; } notify(rides, "control", { a: body.a }); res.statusCode = 204; res.end();
    });
    if(url.pathname === "/__remote/state" && req.method === "POST") return readBody(req, body => {
      if(!body || !Number.isInteger(body.gear) || body.gear < 1 || body.gear > 24 || !["gear", "bias", "hr"].includes(body.mode) || !Number.isFinite(body.bias) || body.bias < 0.5 || body.bias > 1.5 || !Number.isInteger(body.hrOff) || body.hrOff < -20 || body.hrOff > 20){ fail(400); return; }
      if([body.started, body.running].some(v => v !== undefined && typeof v !== "boolean")){ fail(400); return; }
      Object.assign(state, { gear: body.gear, mode: body.mode, bias: body.bias, hrOff: body.hrOff });
      if(typeof body.started === "boolean") state.started = body.started;
      if(typeof body.running === "boolean") state.running = body.running;
      notify(phones, "state", { ...state, ride: rides.size > 0 }); res.statusCode = 204; res.end();
    });
    if(url.pathname === "/__remote/shift" || url.pathname === "/__remote/control" || url.pathname === "/__remote/state" || url.pathname === "/__remote/events"){ fail(405); return true; }
    fail(404); return true;
  }
  function readBody(req, done){ let text = ""; req.on("data", chunk => { text += chunk; }); req.on("end", () => { try{ done(JSON.parse(text)); }catch{ done(null); } }); return true; }
  return { route, close(){ clearInterval(heartbeat); for(const res of [...rides, ...phones]) res.end(); rides.clear(); phones.clear(); } };
}
module.exports = { createRemote, lanLinks };
