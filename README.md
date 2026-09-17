# gemini-web-proxy

Render Node.js 反代 Gemini 网页版。单域名 + 路径前缀分发到 Google 各子域名，响应体 URL 自动改写。

## 部署到 Render

### 方式一：Blueprint（推荐）

1. 把项目推到 GitHub
2. Render Dashboard → New → Blueprint
3. 选择仓库，Render 自动读 `render.yaml`
4. 部署完成，访问 `https://gemini-web-proxy.onrender.com`

### 方式二：手动

1. Render Dashboard → New → Web Service
2. 连接 GitHub 仓库
3. 填写：
   - **Runtime**: Node
   - **Build**: `npm install`
   - **Start**: `node src/index.js`
   - **Plan**: Free
4. 部署

## 本地调试

```bash
node src/index.js
# 访问 http://localhost:10000
```

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

- Render 免费版 15 分钟无请求会休眠，下次访问冷启动约 30-50 秒
- 不支持 Docker（纯 Node.js 源码部署）
- Google 的 CSP 策略可能阻断部分子资源
- 登录后 cookie 绑定到 Render 域名

## License

MIT
