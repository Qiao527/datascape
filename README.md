# Datascape

把熟悉的 2D 图表变成可以绕着看、可以互动的 3D 场景。Vite + Three.js，没有前端框架。

| 页面 | 原来的 2D 图 | 变成 |
|---|---|---|
| `skyline.html` · Commit City | GitHub 贡献日历 | 一座夜晚的城市（或一片等高线地形），每一天是一栋楼 |
| `pulsar.html` · PSR B1919+21 | 脉冲星堆叠折线图（那张著名唱片封面） | 随音乐起伏、向远方流去的白色山脊 |

## 运行

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 输出到 dist/
npm run preview    # 预览构建结果（同样带 /api/contributions）
```

需要 Node.js 20+。

### GitHub 数据

浏览器不能直接拿到贡献日历，所以由服务端接口 `/api/contributions?user=<用户名>&year=<年份>` 获取：

- 设置了环境变量 `GITHUB_TOKEN`（任意只读 token）时，走 GitHub 官方 GraphQL API。
- 没有 token 时，解析 `github.com/users/<name>/contributions` 公开页面。不需要任何配置，但 GitHub 改版时可能失效。

结果在服务端内存里缓存 10 分钟。

## 结构

```text
index.html, skyline.html, pulsar.html   入口页面
server/contributions.js                 获取并解析贡献数据（Node 与 Workers 通用）
functions/api/contributions.js          Cloudflare Pages Function 适配
vite.config.js                          多页面构建 + 开发服务器上的 /api 中间件
src/shared/                             渲染器、后期（MSAA + Bloom）、基础样式
src/skyline/
  data.js          日历 → 网格坐标、统计（总数、最长连续等）
  city.js          InstancedMesh 楼群：窗户、楼顶光、升起动画全在 shader 里
  terrain.js       高斯叠加的地形 + 发光等高线
  environment.js   天空、星星、反光地面、浮尘、刻字底座
  main.js          界面、悬停提示、截图、相机
src/pulsar/
  ridges.js        环形缓冲浮点纹理 + 黑色遮挡面 + 屏幕空间粗线
  shaping.js       合成脉冲信号 / 对数频谱 → 一行高度
  audio.js         内置合成器、上传文件、麦克风三种来源
  demoSynth.js     Web Audio 合成的 124 BPM 演示循环
```

## 部署（Cloudflare Pages）

构建命令 `npm run build`，输出目录 `dist`。`functions/` 目录会被自动识别为 `/api/contributions` 接口。建议在项目环境变量里设置 `GITHUB_TOKEN`，避免公开页面被限流。
