/**
 * gemini-web-proxy — Cloudflare Worker
 *
 * 反代 Gemini 网页版，单域名 + 路径前缀分发到 Google 各子域名。
 * 用 HTMLRewriter 改写页面里的绝对 URL → 本域路径。
 *
 * 路径映射:
 *   /                → gemini.google.com
 *   /accounts/       → accounts.google.com
 *   /content-push/   → content-push.googleapis.com
 *   /lh3/            → lh3.googleusercontent.com
 *   /ssl-gstatic/    → ssl.gstatic.com
 *   /www-gstatic/    → www.gstatic.com
 *   /fonts-api/      → fonts.googleapis.com
 *   /fonts-gstatic/  → fonts.gstatic.com
 *   /clients6/       → clients6.google.com
 *   /play/           → play.google.com
 *   /apis/           → apis.google.com
 *   /www-google/     → www.google.com
 */

// ── 路径 → 子域名映射表（顺序：长前缀优先）──────────────────
const HOST_MAP = [
  ['/accounts/',       'accounts.google.com'],
  ['/content-push/',   'content-push.googleapis.com'],
  ['/fonts-api/',      'fonts.googleapis.com'],
  ['/fonts-gstatic/',  'fonts.gstatic.com'],
  ['/ssl-gstatic/',    'ssl.gstatic.com'],
  ['/www-gstatic/',    'www.gstatic.com'],
  ['/lh3/',            'lh3.googleusercontent.com'],
  ['/clients6/',       'clients6.google.com'],
  ['/play/',           'play.google.com'],
  ['/apis/',           'apis.google.com'],
  ['/www-google/',     'www.google.com'],
  ['/',                'gemini.google.com'],
];

// ── URL 改写规则（用于 HTMLRewriter）────────────────────────
// 源域名 → 本域路径前缀
const REWRITE_RULES = [
  ['https://gemini.google.com',             ''],
  ['https://accounts.google.com',           '/accounts'],
  ['https://content-push.googleapis.com',   '/content-push'],
  ['https://lh3.googleusercontent.com',     '/lh3'],
  ['https://ssl.gstatic.com',               '/ssl-gstatic'],
  ['https://www.gstatic.com',               '/www-gstatic'],
  ['https://fonts.googleapis.com',          '/fonts-api'],
  ['https://fonts.gstatic.com',             '/fonts-gstatic'],
  ['https://clients6.google.com',           '/clients6'],
  ['https://play.google.com',               '/play'],
  ['https://apis.google.com',               '/apis'],
  ['https://www.google.com',                '/www-google'],
];

// 构建 origin → 本域前缀的快速查找
const ORIGIN_MAP = new Map(REWRITE_RULES);

// ── 解析请求路径，找到目标 host 和去掉前缀后的 path ──────────
function resolveTarget(url) {
  const u = new URL(url);
  for (const [prefix, host] of HOST_MAP) {
    if (u.pathname.startsWith(prefix)) {
      const stripped = u.pathname.slice(prefix.length - 1);
      const targetPath = stripped.startsWith('/') ? stripped : '/' + stripped;
      return {
        host,
        pathname: targetPath + u.search,
        prefix,
      };
    }
  }
  return null;
}

// ── 改写响应体中的 URL（对 text/html 和 JS）──────────────────
function rewriteBody(text, myOrigin) {
  let result = text;
  for (const [origin, prefix] of REWRITE_RULES) {
    if (origin === 'https://gemini.google.com') {
      result = result.split(origin).join(myOrigin);
    } else {
      result = result.split(origin).join(myOrigin + prefix);
    }
  }
  return result;
}

// ── 改写 Location / Set-Cookie 等响应头 ──────────────────────
function rewriteHeaders(headerValue, myOrigin) {
  if (!headerValue) return headerValue;
  let result = headerValue;
  for (const [origin, prefix] of REWRITE_RULES) {
    if (origin === 'https://gemini.google.com') {
      result = result.split(origin).join(myOrigin);
    } else {
      result = result.split(origin).join(myOrigin + prefix);
    }
  }
  return result;
}

// ── 改写 Set-Cookie 的 domain/path ───────────────────────────
function rewriteSetCookie(cookieStr, targetHost, myOrigin) {
  let result = cookieStr;
  for (const [origin, prefix] of REWRITE_RULES) {
    if (origin === 'https://gemini.google.com') {
      result = result.split(origin).join(myOrigin);
    } else {
      result = result.split(origin).join(myOrigin + prefix);
    }
  }
  result = result.replace(/domain=[^;]+/gi, `domain=${new URL(myOrigin).hostname}`);
  return result;
}

// ── Worker 入口 ──────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const myOrigin = `${url.protocol}//${url.host}`;

    const target = resolveTarget(request.url);
    if (!target) {
      return new Response('Bad gateway: no route matched', { status: 502 });
    }

    // 构建上游请求
    const upstreamUrl = `https://${target.host}${target.pathname}`;
    const upstreamReq = new Request(upstreamUrl, request);

    // 改写请求头
    upstreamReq.headers.set('Host', target.host);
    upstreamReq.headers.delete('cf-connecting-ip');
    upstreamReq.headers.delete('cf-ipcountry');
  upstreamReq.headers.delete('cf-ray');
  upstreamReq.headers.delete('cf-visitor');
  upstreamReq.headers.set('Referer', `https://${target.host}/`);

    // 发请求
    let upstreamRes;
    try {
      upstreamRes = await fetch(upstreamReq);
    } catch (err) {
      return new Response(`Upstream error: ${err.message}`, { status: 502 });
    }

    // 克隆响应以便修改头
    const res = new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: new Headers(upstreamRes.headers),
    });

    // 改写 Location 头（重定向）
    const location = res.headers.get('Location');
    if (location) {
      res.headers.set('Location', rewriteHeaders(location, myOrigin));
    }

    // 改写 Set-Cookie
    const setCookies = res.headers.getAll?.('Set-Cookie') || [res.headers.get('Set-Cookie')].filter(Boolean);
    if (setCookies.length > 0) {
      res.headers.delete('Set-Cookie');
      for (const cookie of setCookies) {
        res.headers.append('Set-Cookie', rewriteSetCookie(cookie, target.host, myOrigin));
      }
    }

    // 改写 Access-Control-Allow-Origin
    const aco = res.headers.get('Access-Control-Allow-Origin');
    if (aco && aco !== '*') {
      res.headers.set('Access-Control-Allow-Origin', myOrigin);
    }

    // 对 HTML / JS / JSON 做 URL 替换
    const contentType = res.headers.get('Content-Type') || '';
    const isRewritable =
      contentType.includes('text/html') ||
      contentType.includes('javascript') ||
      contentType.includes('application/json') ||
      contentType.includes('text/css');

    if (isRewritable) {
      const body = await res.text();
      const rewritten = rewriteBody(body, myOrigin);
      return new Response(rewritten, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }

    return res;
  },
};
