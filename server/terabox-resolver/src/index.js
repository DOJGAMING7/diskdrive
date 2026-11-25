import { isTeraboxUrl, resolveTerabox } from "./terabox.js";

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "*";
  const allowed = String(env.ALLOWED_ORIGINS || "*").trim();
  const allowOrigin = allowed === "*" ? "*" : allowed.split(",").map(s => s.trim()).filter(Boolean).includes(origin) ? origin : allowed.split(",")[0].trim() || "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Resolver-Key",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, status = 200, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(request, env) },
  });
}

function getConfig(env) {
  return {
    teraboxNdus: String(env.TERABOX_NDUS || "").trim(),
    teraboxCookie: String(env.TERABOX_COOKIE || "").trim(),
    resolverSecret: String(env.RESOLVER_SECRET || "").trim(),
  };
}

function unauthorized(request, env) {
  return json({ ok: false, error: "unauthorized", message: "Invalid resolver key" }, 401, request, env);
}

async function parseBody(request) {
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await request.json().catch(() => ({}));
  const text = await request.text();
  try { return JSON.parse(text); } catch { return { url: text.trim() }; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json({ ok: true, service: "diskdrive-terabox-resolver" }, 200, request, env);
    }

    if (request.method === "POST" && (url.pathname === "/resolve" || url.pathname === "/v1/terabox/resolve")) {
      const config = getConfig(env);
      const requiredSecret = config.resolverSecret;
      if (requiredSecret) {
        const got = String(request.headers.get("x-resolver-key") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "").trim();
        if (got !== requiredSecret) return unauthorized(request, env);
      }

      const body = await parseBody(request);
      const inputUrl = String(body.url || body.link || "").trim();
      if (!inputUrl) return json({ ok: false, error: "missing_url", message: "Missing url" }, 400, request, env);
      if (!isTeraboxUrl(inputUrl)) return json({ ok: false, error: "invalid_link", message: "Not a Terabox link" }, 400, request, env);

      try {
        const result = await resolveTerabox(inputUrl, config);
        const directUrl = String(result.directUrl || result.streamUrl || "").trim();
        if (!directUrl) {
          return json({ ok: false, error: "no_dlink", message: result.note || "No direct link available", provider: "terabox", name: result.name || "", size: result.size || null, sizeHuman: result.sizeHuman || "", sourceUrl: result.sourceUrl || inputUrl }, 502, request, env);
        }
        return json({
          ok: true,
          provider: "terabox",
          name: result.name || "Terabox file",
          size: result.size || null,
          sizeHuman: result.sizeHuman || "",
          date: result.date || "",
          directUrl,
          streamUrl: String(result.streamUrl || directUrl),
          sourceUrl: result.sourceUrl || inputUrl,
          note: result.note || "",
        }, 200, request, env);
      } catch (e) {
        const msg = String(e?.message || e || "Resolve failed");
        const lower = msg.toLowerCase();
        const code = lower.includes("auth") || lower.includes("ndus") ? "auth_failed"
          : lower.includes("not found") || lower.includes("no files") ? "not_found"
          : lower.includes("extract terabox share id") ? "invalid_link"
          : "resolve_failed";
        const status = code === "invalid_link" ? 400 : code === "not_found" ? 404 : code === "auth_failed" ? 502 : 502;
        return json({ ok: false, error: code, message: msg.slice(0, 500) }, status, request, env);
      }
    }

    return json({ ok: false, error: "not_found" }, 404, request, env);
  },
};
