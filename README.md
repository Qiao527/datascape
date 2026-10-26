# Datascape

[![CI](https://github.com/Qiao527/datascape/actions/workflows/ci.yml/badge.svg)](https://github.com/Qiao527/datascape/actions/workflows/ci.yml)

把熟悉的 2D 图表变成可以绕着看、可以互动的 3D 场景。Vite + Three.js，没有前端框架。

| 页面 | 原来的 2D 图 | 变成 |
|---|---|---|
| `skyline.html` · Commit City | GitHub 贡献日历 | 一座夜晚的城市（或一片等高线地形），每一天是一栋楼 |
| `pulsar.html` · PSR B1919+21 | 脉冲星堆叠折线图（那张著名唱片封面） | 随音乐起伏、向远方流去的白色山脊 |
| `storm.html` · Storm Chamber | 气象雷达回波图 | 2013 年 Rozel 龙卷触地前 13 分钟的一次真实雷达体扫：14 层扫描锥面，以及由它们填成的、可以剖开的风暴（英文页面） |

## 运行

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 输出到 dist/
npm run preview    # 预览构建结果（同样带 /api/contributions）
```

需要 Node.js 20+（CI 使用 `.nvmrc` 里的 22）。Storm Chamber 需要支持 WebGL 2 的浏览器。

## 测试

```bash
npm test               # 单元测试（Vitest）：雷达数据完整性、波束几何、叙事里每个数字的来源
npm run test:e2e       # 浏览器测试（Playwright）：构建后在 Chrome 里走完所有章节、交互与无障碍检查
```

本地的浏览器测试会用已安装的 Google Chrome（真实 GPU）。CI 里用 Playwright 自带的 Chromium，WebGL 由 SwiftShader 软件渲染。

Storm Chamber 的数据可以从 NOAA 原始文件逐字节复现：

```bash
python -m venv .venv && .venv/bin/pip install -r scripts/storm/requirements.txt
PYTHON=.venv/bin/python scripts/storm/check_reproducible.sh
```

数据来源、处理方法、验证结果和已知局限见 [`docs/storm-chamber.md`](docs/storm-chamber.md)。

### GitHub 数据

浏览器不能直接拿到贡献日历，所以由服务端接口 `/api/contributions?user=<用户名>&year=<年份>` 获取：

- 设置了环境变量 `GITHUB_TOKEN`（任意只读 token）时，走 GitHub 官方 GraphQL API。
- 没有 token 时，解析 `github.com/users/<name>/contributions` 公开页面。不需要任何配置，但 GitHub 改版时可能失效。

结果在服务端内存里缓存 10 分钟。

## 结构

```text
index.html, skyline.html, pulsar.html, storm.html   入口页面
server/contributions.js                 获取并解析贡献数据（Node 与 Workers 通用）
functions/api/contributions.js          Cloudflare Pages Function 适配
vite.config.js                          多页面构建 + 开发服务器上的 /api 中间件
src/shared/
  base.css, post.js                     渲染器、后期（MSAA + Bloom）、基础样式
  story.js, dimension.js, fonts.js,     章节卡片、相机轨道、场景标签、2D↔3D 维度滑杆、自托管字体
  series.css                            （与 The Hidden Dimension 系列共用）
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
src/storm/
  data.js          解压 storm.bin，CPU 端按体素 / 扫描门查值
  beam.js          4/3 地球半径波束模型（JS 与 GLSL 同一套公式）
  sweeps.js        14 层扫描锥面，最低一层同时是平面雷达图
  volume.js        体渲染：光线步进 + 预计算的阳光 / 天光 + 空域跳过
  chamber.js       边框、高度标尺、剖面、扫描中的波束、龙卷路径
  ground.js        距离圈、方位线、风暴投影
  palette.js       烟雾配色与 NWS 标准配色、图例
  chapters.js      八个章节的文字与镜头
  sound.js         随回波强度变化的雨声
scripts/storm/
  generate_storm.py        NEXRAD Level II → public/data/storm/
  check_reproducible.sh    重新生成并逐字节比对
tests/unit, tests/e2e      Vitest 与 Playwright 测试
```

## 部署（Cloudflare Pages）

构建命令 `npm run build`，输出目录 `dist`，Node 版本取自 `.nvmrc`。`functions/` 目录会被自动识别为 `/api/contributions` 接口。建议在项目环境变量里设置 `GITHUB_TOKEN`，避免公开页面被限流。`public/_headers` 让带哈希的构建产物长期缓存，雷达数据缓存一天。
