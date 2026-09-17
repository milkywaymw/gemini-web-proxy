import http from 'node:http';
import https from 'node:https';

// ── 路径 → 子域名映射表（长前缀优先）──────────────────────
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

// ── URL 改写规则 ──────────────────────────────────────────
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

// ── 解析请求路径 ──────────────────────────────────────────
function resolveTarget(urlPath) {
  for (const [prefix, host] of HOST_MAP) {
    if (urlPath.startsWith(prefix)) {
      const stripped = urlPath.slice(prefix.length - 1);
      const targetPath = stripped.startsWith('/') ? stripped : '/' + stripped;
      return { host, pathname: targetPath, prefix };
    }
  }
  return null;
}

// ── 改写响应体 ────────────────────────────────────────────
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

// ── 改写响应头 ────────────────────────────────────────────
function rewriteHeaderValue(value, myOrigin) {
  if (!value) return value;
  let result = value;
  for (const [origin, prefix] of REWRITE_RULES) {
    if (origin === 'https://gemini.google.com') {
      result = result.split(origin).join(myOrigin);
    } else {
      result = result.split(origin).join(myOrigin + prefix);
    }
  }
  return result;
}

function rewriteSetCookie(cookieStr, myOrigin) {
  let result = rewriteHeaderValue(cookieStr, myOrigin);
  const myHost = new URL(myOrigin).hostname;
  result = result.replace(/domain=[^;]+/gi, `domain=${myHost}`);
  return result;
}

// ── 收集请求体 ────────────────────────────────────────────
function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── 代理请求 ──────────────────────────────────────────────
function proxyRequest(req, res, myOrigin) {
  const target = resolveTarget(req.url);
  if (!target) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad gateway: no route matched');
    return;
  }

  const upstreamPath = target.pathname + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '');
  const options = {
    hostname: target.host,
    port: 443,
    path: upstreamPath,
    method: req.method,
    headers: {
      ...req.headers,
      Host: target.host,
      Referer: `https://${target.host}/`,
    },
  };

  delete options.headers['host'];
  delete options.headers['cf-connecting-ip'];
  delete options.headers['cf-ipcountry'];
  delete options.headers['cf-ray'];
  delete options.headers['cf-visitor'];
  delete options.headers['x-forwarded-for'];
  delete options.headers['x-forwarded-proto'];
  delete options.headers['x-forwarded-port'];
  delete options.headers['x-request-start'];
  delete options.headers['x-render-proxy'];
  delete options.headers['via'];

  const proxyReq = https.request(options, (proxyRes) => {
    const contentType = (proxyRes.headers['content-type'] || '').toLowerCase();
    const isRewritable =
      contentType.includes('text/html') ||
      contentType.includes('javascript') ||
      contentType.includes('application/json') ||
      contentType.includes('text/css');

    // 改写响应头
    const headers = { ...proxyRes.headers };

    if (headers['location']) {
      headers['location'] = rewriteHeaderValue(headers['location'], myOrigin);
    }

    if (headers['set-cookie']) {
      headers['set-cookie'] = headers['set-cookie'].map((c) => rewriteSetCookie(c, myOrigin));
    }

    if (headers['access-control-allow-origin'] && headers['access-control-allow-origin'] !== '*') {
      headers['access-control-allow-origin'] = myOrigin;
    }

    // resumable upload: content-push 不缓冲，直接透传
    if (target.host === 'content-push.googleapis.com' || !isRewritable) {
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
      return;
    }

    // 可改写的: 收完再替换
    const chunks = [];
    proxyRes.on('data', (c) => chunks.push(c));
    proxyRes.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      const rewritten = rewriteBody(body, myOrigin);
      headers['content-length'] = Buffer.byteLength(rewritten).toString();
      res.writeHead(proxyRes.statusCode, headers);
      res.end(rewritten);
    });
    proxyRes.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Upstream stream error');
      }
    });
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Upstream error: ${err.message}`);
    }
  });

  if (req.method === 'GET' || req.method === 'HEAD') {
    proxyReq.end();
  } else {
    req.pipe(proxyReq);
  }
}

// ── 启动 HTTP 服务 ────────────────────────────────────────
const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  const myOrigin = `https://${req.headers.host}`;
  proxyRequest(req, res, myOrigin);
});

server.listen(PORT, () => {
  console.log(`gemini-web-proxy listening on :${PORT}`);
});
