const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const TERABOX_HOSTS = new Set([
  "terabox.com", "www.terabox.com",
  "terabox.app", "www.terabox.app",
  "1024terabox.com", "www.1024terabox.com",
  "4funbox.com", "www.4funbox.com",
  "mirrobox.com", "www.mirrobox.com",
  "nephobox.com", "www.nephobox.com",
  "teraboxlink.com", "www.teraboxlink.com",
  "teraboxshare.com", "www.teraboxshare.com",
  "terasharelink.com", "www.terasharelink.com",
  "terafileshare.com", "www.terafileshare.com",
  "momerybox.com", "www.momerybox.com",
  "tibibox.com", "www.tibibox.com",
]);

export function isTeraboxUrl(url) {
  try {
    const u = new URL(url);
    return TERABOX_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function parseSurl(url) {
  const u = new URL(url);
  let raw = u.searchParams.get("surl") || "";
  if (!raw) {
    const m = u.pathname.match(/\/s\/([A-Za-z0-9_-]+)/);
    if (m) raw = m[1];
  }
  const pwd = (u.searchParams.get("pwd") || u.searchParams.get("password") || "").trim();
  if (!raw) throw new Error("Could not extract Terabox share ID (surl) from link");
  const candidates = [];
  const push = (s) => { s = String(s || "").trim(); if (s && !candidates.includes(s)) candidates.push(s); };
  push(raw);
  if (raw.startsWith("1")) push(raw.slice(1));
  return { surl: candidates[0], candidates, pwd, shareUrl: `https://${u.hostname}/sharing/link?surl=${candidates[0]}` };
}

async function getJsToken(shareUrl, cookie) {
  const res = await fetch(shareUrl, {
    headers: { "User-Agent": UA, Cookie: cookie, Referer: "https://www.terabox.com/" },
    redirect: "follow",
  });
  const text = await res.text();
  let m = text.match(/fn\("([a-fA-F0-9]+)"\)/);
  if (m) return m[1];
  m = text.match(/"jsToken"\s*:\s*"([^"]+)"/);
  if (m) return m[1];
  m = text.match(/fn%28%22(.*?)%22%29/);
  if (m) return m[1];
  return "";
}

async function verifyShare(surl, pwd, cookie) {
  if (!pwd) return;
  const params = new URLSearchParams({ app_id: "250528", surl: `1${surl}`, pwd });
  await fetch(`https://www.terabox.com/share/verify?${params}`, {
    headers: { "User-Agent": UA, Cookie: cookie, Referer: "https://www.terabox.com/" },
  }).catch(() => {});
}

async function listShareRaw(surl, jsToken, cookie, dir = null) {
  const params = new URLSearchParams({
    app_id: "250528",
    web: "1",
    channel: "dubox",
    clienttype: "0",
    jsToken: jsToken || "",
    shorturl: surl,
    page: "1",
    num: "1000",
    by: "name",
    order: "asc",
  });
  if (dir) params.set("dir", dir);
  else params.set("root", "1");

  const res = await fetch(`https://www.terabox.com/share/list?${params}`, {
    headers: { "User-Agent": UA, Cookie: cookie, Referer: "https://www.terabox.com/" },
  });
  return res.json();
}

async function listShare(surlCandidates, jsToken, cookie, pwd) {
  let lastErr = null;
  for (const surl of surlCandidates) {
    await verifyShare(surl, pwd, cookie);
    const data = await listShareRaw(surl, jsToken, cookie, null);
    const errno = Number(data.errno);
    if (errno === 0) return { surl, list: Array.isArray(data.list) ? data.list : [] };
    if ([-6, -1, 1, 2].includes(errno)) {
      lastErr = new Error(`Terabox auth/access failed (errno=${errno}). Check TERABOX_NDUS or link access.`);
      continue;
    }
    lastErr = new Error(`Terabox API error errno=${data.errno}`);
  }
  throw lastErr || new Error("Terabox share list failed");
}



function humanSize(size) {
  const n = Number(size);
  if (!Number.isFinite(n)) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  for (const unit of units) {
    if (v < 1024 || unit === "TB") return unit === "B" ? `${Math.round(v)} B` : `${v.toFixed(2)} ${unit}`;
    v /= 1024;
  }
  return `${n} B`;
}

function pickDate(file) {
  const raw = file?.server_mtime || file?.local_mtime || file?.server_ctime || file?.local_ctime;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return "";
  const ms = n < 1e12 ? n * 1000 : n;
  try {
    return new Date(ms).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function buildCookie(configOrNdus) {
  if (typeof configOrNdus === "string") {
    const ndus = configOrNdus.trim();
    if (!ndus) throw new Error("TERABOX_NDUS or TERABOX_COOKIE is not configured. Add it as a Worker secret.");
    return `ndus=${ndus}`;
  }
  const cookie = String(configOrNdus?.teraboxCookie || "").trim();
  const ndus = String(configOrNdus?.teraboxNdus || "").trim();
  if (cookie) return cookie;
  if (ndus) return `ndus=${ndus}`;
  throw new Error("TERABOX_NDUS or TERABOX_COOKIE is not configured. Add it as a Worker secret.");
}

async function collectFiles(surl, jsToken, cookie, entries) {
  const files = [];
  for (const item of entries) {
    if (String(item.isdir) === "1") {
      const data = await listShareRaw(surl, jsToken, cookie, item.path);
      const children = Array.isArray(data.list) ? data.list : [];
      files.push(...await collectFiles(surl, jsToken, cookie, children));
    } else {
      files.push(item);
    }
  }
  return files;
}

async function resolveViaPublicProxy(url) {
  // Safe fallback: no account cookies sent. Only public share metadata is queried.
  const { candidates, surl, shareUrl } = parseSurl(url);
  for (const s of (candidates && candidates.length ? candidates : [surl])) {
    const params = new URLSearchParams({ mode: "resolve", surl: s, raw: "1" });
    const res = await fetch(`https://tbx-proxy.shakir-ansarii075.workers.dev/?${params}`, {
      headers: { "User-Agent": UA },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) continue;

    // raw=1: {source, upstream:{list:[...]}} or simplified shapes
    const upstream = data.upstream || data;
    const list = Array.isArray(upstream?.list) ? upstream.list : Array.isArray(upstream?.data?.list) ? upstream.data.list : [];
    const flatFiles = [];
    const walk = (items) => {
      for (const it of items || []) {
        if (String(it.isdir) === "1") { if (Array.isArray(it.children)) walk(it.children); continue; }
        flatFiles.push(it);
      }
    };
    walk(list);
    // simplified data shape
    if (!flatFiles.length && upstream?.data?.dlink) {
      flatFiles.push(upstream.data);
    }
    const file = flatFiles[0];
    const directUrl = String(file?.dlink || "").trim();
    if (!directUrl) continue;
    return {
      provider: "terabox",
      name: String(file.server_filename || file.filename || file.name || "Terabox file"),
      size: Number(file.size) || null,
      sizeHuman: humanSize(file.size),
      directUrl,
      streamUrl: directUrl,
      sourceUrl: shareUrl,
      note: "Resolved via public proxy fallback (no account cookie sent).",
    };
  }
  throw new Error("Public proxy fallback could not resolve a direct link.");
}

async function resolveViaDmTeraboxApp(url, cookie) {
  const { surl, candidates, shareUrl } = parseSurl(url);
  const errs = [];
  const hosts = [
    { host: "dm.terabox.app", origin: "https://www.terabox.app" },
    { host: "dm.terabox.com", origin: "https://www.terabox.com" },
  ];
  for (const { host, origin } of hosts) {
    for (const shorturl of (candidates.length ? candidates : [surl])) {
      try {
        const pageUrl = `https://${host}/sharing/link?surl=${shorturl}`;
        const page = await fetch(pageUrl, { headers: { "User-Agent": UA, Cookie: cookie, Referer: `${origin}/` } });
        const text = await page.text();
        let m = text.match(/fn%28%22(.*?)%22%29/);
        let jsToken = m ? m[1] : "";
        if (!jsToken) { m = text.match(/fn\("([a-fA-F0-9]+)"\)/); jsToken = m ? m[1] : ""; }
        const params = new URLSearchParams({
          app_id: "250528",
          jsToken,
          site_referer: `${origin}/`,
          shorturl,
          root: "1",
        });
        const res = await fetch(`https://${host}/share/list?${params}`, {
          headers: {
            "User-Agent": UA,
            Accept: "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest",
            Referer: `https://${host}/sharing/link?surl=${shorturl}&clearCache=1`,
            Origin: origin,
            Cookie: cookie,
          },
        });
        const data = await res.json().catch(() => null);
        if (!data) { errs.push(`${host}:${shorturl}:no-json`); continue; }
        if (Number(data.errno) !== 0) { errs.push(`${host}:${shorturl}:errno=${data.errno}${jsToken ? "" : ":no-jsToken"}`); continue; }
        const out = [];
        const walk = async (items) => {
          for (const it of items || []) {
            if (String(it.isdir) === "1") {
              const childParams = new URLSearchParams({ app_id: "250528", jsToken, site_referer: `${origin}/`, shorturl, dir: it.path });
              const cr = await fetch(`https://${host}/share/list?${childParams}`, { headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*", Cookie: cookie, Referer: `https://${host}/sharing/link?surl=${shorturl}&clearCache=1`, Origin: origin } });
              const cd = await cr.json().catch(() => null);
              await walk(Array.isArray(cd?.list) ? cd.list : []);
            } else out.push(it);
          }
        };
        await walk(Array.isArray(data.list) ? data.list : []);
        const file = out[0];
        const directUrl = String(file?.dlink || "").trim();
        if (!directUrl) { errs.push(`${host}:${shorturl}:no-dlink`); continue; }
        return {
          provider: "terabox",
          name: String(file.server_filename || file.filename || "Terabox file"),
          size: Number(file.size) || null,
          sizeHuman: humanSize(file.size),
          date: pickDate(file),
          directUrl,
          streamUrl: directUrl,
          sourceUrl: url,
        };
      } catch (e) {
        errs.push(`${host}:${shorturl}:${String(e?.message || e).slice(0, 60)}`);
      }
    }
  }
  throw new Error(`dm resolve failed${errs.length ? ` (${errs.join(", ")})` : ""}`);
}

async function resolveViaExternalResolver(url, config) {
  const base = String(config?.resolverUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("RESOLVER_URL not configured");
  const headers = { "content-type": "application/json" };
  if (config?.resolverSecret) headers["x-resolver-secret"] = String(config.resolverSecret);
  const res = await fetch(`${base}/resolve`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(`external resolver http ${res.status}`);
  if (data.error) throw new Error(String(data.error).slice(0, 200));
  if (!data.directUrl) throw new Error("external resolver returned no directUrl");
  return data;
}

export async function resolveTerabox(url, configOrNdus) {
  const config = typeof configOrNdus === "string" ? { teraboxNdus: configOrNdus } : (configOrNdus || {});
  const cookie = buildCookie(config);
  const { surl, candidates, pwd, shareUrl } = parseSurl(url);
  const debug = [];

  // 0) Optional external resolver (useful when CF Worker IPs are blocked by Terabox).
  if (config.resolverUrl) {
    try {
      const ext = await resolveViaExternalResolver(url, config);
      if (ext?.directUrl) return ext;
      debug.push("external:no-dlink");
    } catch (e) {
      debug.push(`external:${String(e?.message || e).slice(0, 140)}`);
    }
  }

  // 1) Fast path: dm.terabox.app often returns dlink with account cookie.
  try {
    const dm = await resolveViaDmTeraboxApp(url, cookie);
    if (dm?.directUrl) return dm;
    debug.push("dm:no-dlink");
  } catch (e) {
    debug.push(`dm:${String(e?.message || e).slice(0, 140)}`);
  }

  // 2) www.terabox.com share/list flow - good for metadata, sometimes has dlink.
  let lastMeta = null;
  try {
    const jsToken = await getJsToken(shareUrl, cookie);
    const { surl: resolvedSurl, list: root } = await listShare(candidates.length ? candidates : [surl], jsToken, cookie, pwd);
    const files = await collectFiles(resolvedSurl, jsToken, cookie, root);
    if (!files.length) throw new Error("No files found. Link may be invalid, expired, or inaccessible.");
    const file = files[0];
    lastMeta = file;
    const directUrl = String(file.dlink || "").trim();
    if (directUrl) {
      return {
        provider: "terabox",
        name: String(file.server_filename || file.filename || "Terabox file"),
        size: Number(file.size) || null,
        sizeHuman: humanSize(file.size),
        date: pickDate(file),
        directUrl,
        streamUrl: directUrl,
        sourceUrl: url,
        note: "Resolved via www.terabox.com",
      };
    }
    debug.push("www:no-dlink");
  } catch (e) {
    debug.push(`www:${String(e?.message || e).slice(0, 140)}`);
  }

  // 3) Public no-cookie proxy fallback. Never send account cookie.
  try {
    const pub = await resolveViaPublicProxy(url);
    if (pub?.directUrl) return pub;
    debug.push("proxy:no-dlink");
  } catch (e) {
    debug.push(`proxy:${String(e?.message || e).slice(0, 140)}`);
  }

  // 4) Metadata-only fallback.
  if (lastMeta) {
    return {
      provider: "terabox",
      name: String(lastMeta.server_filename || lastMeta.filename || "Terabox file"),
      size: Number(lastMeta.size) || null,
      sizeHuman: humanSize(lastMeta.size),
      date: pickDate(lastMeta),
      directUrl: "",
      streamUrl: "",
      sourceUrl: url,
      note: `Metadata resolved, but no direct dlink. ${debug.length ? `Debug: ${debug.join(" ; ")}` : ""}`.trim(),
    };
  }

  throw new Error(`Terabox could not resolve link. ${debug.length ? `Debug: ${debug.join(" ; ")}` : ""}`.trim());
}
