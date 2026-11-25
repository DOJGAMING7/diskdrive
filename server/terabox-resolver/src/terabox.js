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
  try { const u = new URL(String(url).trim()); return TERABOX_HOSTS.has(u.hostname.toLowerCase()); } catch { return false; }
}

function parseSurl(url) {
  const u = new URL(String(url).trim());
  let raw = (u.searchParams.get("surl") || "").trim();
  if (!raw) {
    const m = u.pathname.match(/\/s\/([A-Za-z0-9_-]+)/);
    if (m) raw = m[1];
  }
  const pwd = (u.searchParams.get("pwd") || u.searchParams.get("password") || "").trim();
  if (!raw) throw new Error("Could not extract Terabox share ID (surl) from link");
  const clean = raw.replace(/^1/, "");
  const candidates = [];
  const push = (s) => { s = String(s || "").trim(); if (s && !candidates.includes(s)) candidates.push(s); };
  push(raw); push(clean); push(`1${clean}`);
  return { surl: clean, candidates, pwd, shareUrl: `https://${u.hostname}/sharing/link?surl=${clean}` };
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

function humanSize(size) {
  const n = Number(size);
  if (!Number.isFinite(n) || n < 0) return "unknown";
  const units = ["B","KB","MB","GB","TB"];
  let v = n;
  for (const unit of units) {
    if (v < 1024 || unit === "TB") return unit === "B" ? `${Math.round(v)} B` : `${v.toFixed(2)} ${unit}`;
    v /= 1024;
  }
  return `${n} B`;
}

function pickDate(file) {
  const raw = file?.server_mtime || file?.local_mtime || file?.server_ctime || file?.local_ctime;
  const n = Number(raw); if (!Number.isFinite(n) || n <= 0) return "";
  try { return new Date(n < 1e12 ? n * 1000 : n).toISOString().slice(0, 10); } catch { return ""; }
}

function toResult(file, sourceUrl, note = "") {
  const directUrl = String(file?.dlink || "").trim();
  return {
    provider: "terabox",
    name: String(file?.server_filename || file?.filename || file?.name || "Terabox file"),
    size: Number(file?.size) || null,
    sizeHuman: humanSize(file?.size),
    date: pickDate(file),
    directUrl,
    streamUrl: directUrl,
    sourceUrl,
    note,
  };
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _nonJson: true, _status: res.status, _text: text.slice(0, 120) }; }
}

async function getSharePageInfo(shareUrl, cookie) {
  const res = await fetch(shareUrl, { headers: { "User-Agent": UA, Cookie: cookie, Referer: "https://www.terabox.com/" }, redirect: "follow" });
  const text = await res.text();
  const pick = (re) => { const m = text.match(re); return m ? m[1] : ""; };
  return {
    jsToken: pick(/fn\("([a-fA-F0-9]+)"\)/) || pick(/"jsToken"\s*:\s*"([^"]+)"/) || pick(/fn%28%22(.*?)%22%29/) || "",
    sign: pick(/"sign"\s*:\s*"([^"]+)"/),
    timestamp: pick(/"timestamp"\s*:\s*"?(\d+)"?/),
    shareid: pick(/"shareid"\s*:\s*"?(\d+)"?/),
    uk: pick(/"uk"\s*:\s*"?(\d+)"?/),
    seckey: pick(/"seckey"\s*:\s*"([^"]+)"/),
  };
}

async function verifyShare(surl, pwd, cookie, host = "www.terabox.com") {
  if (!pwd) return;
  const params = new URLSearchParams({ app_id: "250528", surl: `1${String(surl).replace(/^1/, "")}`, pwd });
  await fetch(`https://${host}/share/verify?${params}`, { headers: { "User-Agent": UA, Cookie: cookie, Referer: `https://${host}/` } }).catch(() => {});
}

async function listShareRaw(surl, jsToken, cookie, dir = null, host = "www.terabox.com") {
  const params = new URLSearchParams({
    app_id: "250528", web: "1", channel: "dubox", clienttype: "0",
    jsToken: jsToken || "", shorturl: String(surl).replace(/^1/, ""), page: "1", num: "1000", by: "name", order: "asc",
  });
  if (dir) params.set("dir", dir); else params.set("root", "1");
  return fetchJson(`https://${host}/share/list?${params}`, { headers: { "User-Agent": UA, Cookie: cookie, Referer: `https://${host}/`, Accept: "application/json" } });
}

async function collectFiles(surl, jsToken, cookie, entries, host = "www.terabox.com") {
  const files = [];
  for (const item of entries || []) {
    if (String(item.isdir) === "1") {
      const data = await listShareRaw(surl, jsToken, cookie, item.path, host);
      files.push(...await collectFiles(surl, jsToken, cookie, Array.isArray(data?.list) ? data.list : [], host));
    } else files.push(item);
  }
  return files;
}

async function getSharedDownload(file, info, cookie, host = "www.terabox.com", surl = "") {
  const { sign, timestamp, shareid, uk, seckey } = info || {};
  if (!sign || !timestamp || !shareid || !uk || !file?.fs_id) return null;
  const params = new URLSearchParams({
    sign, timestamp, clienttype: "0", web: "1", app_id: "250528", channel: "dubox",
  });
  const body = new URLSearchParams({
    encrypt: "0",
    extra: seckey ? JSON.stringify({ seckey }) : "",
    product: "share",
    timestamp: String(timestamp),
    uk: String(uk),
    primaryid: String(shareid),
    fid_list: JSON.stringify([String(file.fs_id)]),
  });
  const data = await fetchJson(`https://${host}/api/sharedownload?${params}`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Cookie: cookie,
      Referer: `https://${host}/sharing/link?surl=${String(surl).replace(/^1/, "")}`,
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (Number(data?.errno) !== 0) return { errno: data?.errno, data };
  const list = Array.isArray(data?.list) ? data.list : [];
  const match = list.find(x => String(x?.fs_id) === String(file.fs_id)) || list[0];
  const dlink = String(match?.dlink || "").trim();
  return dlink ? { ...file, ...match, dlink } : { errno: 0, nodlink: true };
}

async function resolveViaShareApi(url, cookie) {
  const { candidates, pwd, surl, shareUrl } = parseSurl(url);
  const info = await getSharePageInfo(shareUrl, cookie).catch((e) => ({ _err: String(e?.message||e).slice(0,60) }));
  const errs = [];
  if (!info.sign || !info.timestamp) errs.push(`info:sign=${info.sign?'y':'n'} ts=${info.timestamp?'y':'n'} js=${info.jsToken?'y':'n'}${info._err?':'+info._err:''}`);
  for (const cand of candidates) {
    try {
      await verifyShare(cand, pwd, cookie, "www.terabox.com");
      const data = await listShareRaw(cand, info.jsToken, cookie, null, "www.terabox.com");
      const errno = Number(data?.errno);
      if (errno !== 0) { errs.push(`list:${cand}:errno=${errno}`); continue; }
      const files = await collectFiles(cand, info.jsToken, cookie, Array.isArray(data?.list) ? data.list : [], "www.terabox.com");
      const file = files[0];
      if (!file) { errs.push(`list:${cand}:no-files`); continue; }

      if (String(file?.dlink || "").trim()) {
        return { result: toResult(file, url, "Resolved via www share/list") };
      }

      // New Terabox flow: share/list may omit dlink; fetch via /api/sharedownload
      for (const host of ["www.terabox.com", "dm.terabox.app", "dm.terabox.com"]) {
        try {
          const dl = await getSharedDownload(file, info, cookie, host, cand);
          if (dl?.dlink) return { result: toResult(dl, url, `Resolved via ${host}/api/sharedownload`) };
          if (dl?.errno && dl.errno !== 0) errs.push(`sharedownload:${host}:errno=${dl.errno}`);
          else if (dl?.nodlink) errs.push(`sharedownload:${host}:no-dlink`);
        } catch (e) { errs.push(`sharedownload:${host}:${String(e?.message || e).slice(0, 50)}`); }
      }

      return { meta: file, sourceUrl: url, note: "metadata:no-dlink" };
    } catch (e) {
      errs.push(`${cand}:${String(e?.message || e).slice(0, 80)}`);
    }
  }
  throw new Error(errs.join("; ") || "share api failed");
}

async function resolveViaDm(url, cookie) {
  const { candidates, shareUrl } = parseSurl(url);
  const info = await getSharePageInfo(shareUrl, cookie).catch((e) => ({ _err: String(e?.message||e).slice(0,60) }));
  const errs = [];
  if (!info.sign || !info.timestamp) errs.push(`info:sign=${info.sign?'y':'n'} ts=${info.timestamp?'y':'n'} js=${info.jsToken?'y':'n'}${info._err?':'+info._err:''}`);
  const hosts = [{ host: "dm.terabox.app", origin: "https://www.terabox.app" }, { host: "dm.terabox.com", origin: "https://www.terabox.com" }];
  for (const { host, origin } of hosts) {
    for (const shorturl of candidates) {
      try {
        const page = await fetch(`https://${host}/sharing/link?surl=${shorturl.replace(/^1/, "")}`, { headers: { "User-Agent": UA, Cookie: cookie, Referer: `${origin}/` } });
        const text = await page.text();
        let jsToken = info.jsToken || "";
        let m = text.match(/fn%28%22(.*?)%22%29/); if (m) jsToken = m[1];
        if (!jsToken) { m = text.match(/fn\("([a-fA-F0-9]+)"\)/); if (m) jsToken = m[1]; }
        const params = new URLSearchParams({ app_id: "250528", jsToken, site_referer: `${origin}/`, shorturl: shorturl.replace(/^1/, ""), root: "1" });
        const data = await fetchJson(`https://${host}/share/list?${params}`, {
          headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest", Referer: `https://${host}/sharing/link?surl=${shorturl.replace(/^1/, "")}&clearCache=1`, Origin: origin, Cookie: cookie },
        });
        if (Number(data?.errno) !== 0) { errs.push(`${host}:${shorturl}:errno=${data?.errno}`); continue; }
        const out = [];
        const walk = async (items) => {
          for (const it of items || []) {
            if (String(it.isdir) === "1") {
              const cp = new URLSearchParams({ app_id: "250528", jsToken, site_referer: `${origin}/`, shorturl: shorturl.replace(/^1/, ""), dir: it.path });
              const cd = await fetchJson(`https://${host}/share/list?${cp}`, { headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*", Cookie: cookie, Referer: `https://${host}/sharing/link?surl=${shorturl.replace(/^1/, "")}&clearCache=1`, Origin: origin } });
              await walk(Array.isArray(cd?.list) ? cd.list : []);
            } else out.push(it);
          }
        };
        await walk(Array.isArray(data?.list) ? data.list : []);
        const file = out[0];
        if (!file) { errs.push(`${host}:${shorturl}:no-files`); continue; }
        if (String(file?.dlink || "").trim()) return { result: toResult(file, url, `Resolved via ${host}`) };
        const dl = await getSharedDownload(file, info, cookie, host, shorturl).catch(() => null);
        if (dl?.dlink) return { result: toResult(dl, url, `Resolved via ${host}/api/sharedownload`) };
        errs.push(`${host}:${shorturl}:no-dlink`);
      } catch (e) { errs.push(`${host}:${String(e?.message || e).slice(0, 60)}`); }
    }
  }
  throw new Error(errs.join("; ") || "dm failed");
}

async function resolveViaPublicProxy(url) {
  const { candidates } = parseSurl(url);
  const errs = [];
  for (const s of candidates) {
    try {
      const params = new URLSearchParams({ mode: "resolve", surl: s.replace(/^1/, ""), raw: "1" });
      const data = await fetchJson(`https://tbx-proxy.shakir-ansarii075.workers.dev/?${params}`, { headers: { "User-Agent": UA } });
      const upstream = data?.upstream || data;
      const list = Array.isArray(upstream?.list) ? upstream.list : Array.isArray(upstream?.data?.list) ? upstream.data.list : [];
      const flat = [];
      const walk = (items) => { for (const it of items || []) { if (String(it.isdir) === "1") { if (Array.isArray(it.children)) walk(it.children); continue; } flat.push(it); } };
      walk(list);
      if (!flat.length && upstream?.data?.dlink) flat.push(upstream.data);
      const file = flat[0];
      if (!file || !String(file?.dlink || "").trim()) { errs.push("no-dlink"); continue; }
      return { result: toResult(file, url, "Resolved via public proxy fallback (no account cookie sent).") };
    } catch (e) { errs.push(String(e?.message || e).slice(0, 60)); }
  }
  throw new Error(errs.join("; ") || "proxy failed");
}

export async function resolveTerabox(url, configOrNdus) {
  const config = typeof configOrNdus === "string" ? { teraboxNdus: configOrNdus } : (configOrNdus || {});
  const cookie = buildCookie(config);
  const debug = [];
  let lastMeta = null;

  const steps = [
    ["shareapi", () => resolveViaShareApi(url, cookie)],
    ["dm", () => resolveViaDm(url, cookie)],
    ["proxy", () => resolveViaPublicProxy(url)],
  ];

  for (const [name, fn] of steps) {
    try {
      const out = await fn();
      if (out?.result?.directUrl) return out.result;
      if (out?.meta) { lastMeta = out.meta; debug.push(out.note || `${name}:no-dlink`); }
      else debug.push(`${name}:no-dlink`);
    } catch (e) {
      debug.push(`${name}:${String(e?.message || e).slice(0, 180)}`);
    }
  }

  if (lastMeta) {
    return { ...toResult(lastMeta, url, `Metadata only. ${debug.join(" ; ")}`), directUrl: "", streamUrl: "" };
  }
  throw new Error(`Terabox could not resolve link. ${debug.join(" ; ")}`.trim());
}
