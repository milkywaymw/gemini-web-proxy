# gemini-web-proxy

Cloudflare Worker 反代 Gemini 网页版。单域名 + 路径前缀分发到 Google 各子域名，用 `rewriteBody` 改写页面里的绝对 URL。

## 部署

```bash
# 1. 安装 wrangler
npm install

# 2. 登录 Cloudflare
npx wrangler login

# 3. 部署
npm run deploy
```

部署后访问 `https://gemini-web-proxy.<你的子域>.workers.dev` 即可打开 Gemini 网页版。

## 自定义域名

在 `wrangler.toml` 里取消注释：

```toml
[routes]
pattern = "gemini.yourdomain.com/*"
custom_domain = true
```

或直接在 Cloudflare Dashboard → Workers → 你的 Worker → Settings → Triggers 里加自定义域名。

## 本地调试

```bash
npm run dev
```

然后访问 `http://localhost:8787`。

## 原理

| 路径前缀 | 上游 |
|---|---|
| `/` | `gemini.google.com` |
| `/accounts/` | `accounts.google.com` |
| `/content-push/` | `content-push.googleapis.com` |
| `/lh3/` | `lh3.googleusercontent.com` |
| `/ssl-gstatic/` | `ssl.gstatic.com` |
| `/www-gstatic/` | `www.gstatic.com` |
| `/fonts-api/` | `fonts.googleapis.com` |
| `/fonts-gstatic/` | `fonts.gstatic.com` |
| `/clients6/` | `clients6.google.com` |
| `/play/` | `play.google.com` |
| `/apis/` | `apis.google.com` |
| `/www-google/` | `www.google.com` |

响应体（HTML / JS / JSON / CSS）里的 Google 绝对 URL 会被改写成本域路径，`Location` 和 `Set-Cookie` 头也会改写。

## 已知限制

- CF Worker 免费版有 CPU 时间限制（10ms/请求），大页面可能超时
- Worker 不缓冲完整请求体，resumable upload（附件上传）可能不完全兼容
- Google 的 CSP 策略可能阻断部分子资源，需要浏览器控制台排查
- 登录后 cookie 绑定到你的 Worker 域名，不是 google.com

## License

MIT
