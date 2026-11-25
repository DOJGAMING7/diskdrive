import http from "node:http";
import { resolveTerabox, isTeraboxUrl } from "./src/terabox.js";

const PORT = Number(process.env.PORT || 8787);
const RESOLVER_SECRET = String(process.env.RESOLVER_SECRET || "").trim();
const TERABOX_NDUS = String(process.env.TERABOX_NDUS || "").trim();
const TERABOX_COOKIE = String(process.env.TERABOX_COOKIE || "").trim();
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "*").trim();

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS === "*" ? "*" : (ALLOWED_ORIGINS.split(",").map(s => s.trim()).filter(Boolean).includes(origin) ? origin : ALLOWED_ORIGINS.split(",")[0]?.trim() || "*");
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Resolver-Key,X-Resolver-Secret",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(res, status, body, origin = "*") {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { _raw: raw }; }
}

function getProvidedKey(req, body) {
  const auth = String(req.headers.authorization || "");
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return String(req.headers["x-resolver-key"] || req.headers["x-resolver-secret"] || bearer || body?.key || body?.resolverKey || body?.secret || "").trim();
}

const server = http.createServer(async (req, res) => {
  const origin = String(req.headers.origin || "*");
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }

  if (req.method === "GET" && (path === "/" || path === "/health")) {
    return json(res, 200, { ok: true, service: "diskdrive-terabox-resolver" }, origin);
  }

  if (req.method === "POST" && (path === "/resolve" || path === "/v1/terabox/resolve")) {
    if (RESOLVER_SECRET) {
      const bodyPeek = await readBody(req);
      const provided = getProvidedKey(req, bodyPeek);
      if (provided !== RESOLVER_SECRET) return json(res, 401, { ok: false, error: "unauthorized" }, origin);
      req._body = bodyPeek;
    }
    const body = req._body || await readBody(req);
    const input = String(body?.url || body?.link || body?.surl || "").trim();
    if (!input) return json(res, 400, { ok: false, error: "missing_url" }, origin);
    if (!isTeraboxUrl(input)) return json(res, 400, { ok: false, error: "invalid_link", message: "Not a Terabox link" }, origin);
    const ndus = TERABOX_NDUS || String(body?.ndus || "").trim();
    const cookie = TERABOX_COOKIE || String(body?.cookie || "").trim();
    if (!ndus && !cookie) return json(res, 500, { ok: false, error: "resolver_not_configured", message: "TERABOX_NDUS or TERABOX_COOKIE secret missing." }, origin);
    try {
      const result = await resolveTerabox(input, { teraboxNdus: ndus, teraboxCookie: cookie });
      return json(res, 200, { ok: true, ...result }, origin);
    } catch (e) {
      return json(res, 502, { ok: false, error: "resolve_failed", message: String(e?.message || e).slice(0, 500) }, origin);
    }
  }

  return json(res, 404, { ok: false, error: "not_found" }, origin);
});

server.listen(PORT, () => {
  console.log(`terabox resolver listening on ${PORT}`);
});
