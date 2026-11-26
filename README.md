# 棍木塔防 · 网页联机版

一个文件的塔防游戏（前端）+ 一个无依赖的 Node.js 房间服务器。打开网页就能单人玩，也能建房间和朋友联机合作，支持聊天和快捷语音。

## 目录结构

```
tower-defense-web/
├── server.js          房间服务器 + 静态页面（Node 18+，无第三方依赖）
├── public/index.html  游戏页面（所有代码都在这一个文件里）
├── package.json       npm start / npm test
├── render.yaml        Render 一键部署配置
├── Dockerfile         Docker 部署配置
└── test/              自动化测试（npm test）
```

## 本地运行

```bash
npm start            # 默认端口 3000
# 打开 http://localhost:3000
```

运行测试：

```bash
npm test             # 启动临时服务器，跑完全部双人联机、单人通关、安全测试
```

## 部署到公网

### 方式 A：Render（推荐，有免费额度，无需服务器）

1. 把整个 `tower-defense-web` 文件夹推送到一个 GitHub 仓库。
2. 登录 [render.com](https://render.com) → New → Blueprint → 选择这个仓库。Render 会读取 `render.yaml` 自动创建服务。
3. 部署完成后，Render 会给你一个 `https://xxxx.onrender.com` 地址，把它发给朋友即可。

注意：免费实例闲置 15 分钟后会休眠，下次访问要等 30–60 秒才能打开；休眠或重启时所有房间会消失。

### 方式 B：Docker（任何支持 Docker 的服务器、Fly.io、Railway 等）

```bash
docker build -t tower-defense .
docker run -d -p 80:3000 --restart unless-stopped --name td tower-defense
```

### 方式 C：自己的 Linux 服务器（Node + pm2 + Nginx）

```bash
npm install -g pm2
PORT=3000 TRUST_PROXY=1 pm2 start server.js --name tower-defense
pm2 save
```

Nginx 反向代理示例（HTTPS 证书可用 certbot 申请）：

```nginx
server {
    server_name your.domain.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口。大多数云平台会自动设置 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `TRUST_PROXY` | 未设置 | 部署在 Nginx / Render 等反向代理后面时设为 `1`，否则所有人会被当成同一个 IP 限流 |
| `MAX_ROOMS` | `300` | 同时存在的房间上限 |
| `RATE_MAX` | `150` | 每个 IP 每 10 秒最多调用接口的次数 |
| `CREATE_PER_10MIN` | `20` | 每个 IP 每 10 分钟最多创建房间的次数 |

## 工作原理与限制

- **房主运行模拟**：对局在房主的浏览器里计算，其他人接收画面并把操作发给房主。房主关闭页面或断网超过 12 秒，房间就会关闭。
- **金币共用、AI 队友**：AI 队友也由房主的浏览器控制。
- **数据只存在内存里**：房间、聊天记录都不会写入硬盘。服务器重启后全部清空。只能跑**一个实例**，不能水平扩展到多台机器。
- **轮询**：各客户端每 250 毫秒向服务器拉取一次数据，没有使用 WebSocket。
- **玩家进度**（通关记录、彩蛋、解锁的奖励塔）保存在各自浏览器的 localStorage 里，换设备或清理缓存会丢失。
- **房主可以作弊**：因为模拟在房主端运行，房主理论上可以修改数据。适合和朋友玩；如果要做公开排行榜或比赛，需要把模拟搬到服务器端。
- **快捷语音**的朗读依赖浏览器和系统的语音功能，不同设备效果可能不同。

## 安全措施

- 请求体最大 1.5 MB，超过返回 413
- 每个 IP 有请求频率限制和建房间次数限制
- 房间数量有上限
- 玩家名字、聊天内容会去掉控制字符，并限制长度
- 聊天内容只作为纯文本显示，不会执行 HTML
- 响应带有 `X-Content-Type-Options: nosniff`
