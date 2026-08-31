# DeepSeek Harness Desktop

当前版本为 `1.3.0`。项目将 Electron 桌面包装器、DSH 服务生命周期管理和 Wallpaper Engine 工具统一在一个可复现的项目中。仓库不包含 DSH 会话、凭据、模型配置或本机路径。

把 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（DSH）网页版包装成**独立桌面应用**，并附带两个实用工具：

1. **壁纸选择器**：在应用内直接选择 Wallpaper Engine 壁纸作为背景（与桌面壁纸独立）。
2. **壁纸文件解析助手**：把 Wallpaper Engine 的非标准格式（PKGV 场景包、TEX 纹理里嵌入的图片/视频/LZ4 精灵表）转成常见格式（mp4 / png / jpg）。

## 特性

- 🖥️ 独立桌面窗口（Electron，自带 Chromium，不依赖 Edge/Chrome）
- 🐋 自带 DeepSeek 图标
- 🎨 应用内壁纸选择器（右下角按钮），支持视频壁纸、静态壁纸、多层场景图层
- 🔧 自动从 Wallpaper Engine 场景包提取高清图/视频（含 LZ4 压缩精灵表解码）
- 🔒 只停止经过身份校验、由本应用启动的 DSH 服务；外部服务不会被强制结束
- 🛡️ 启动前校验 DSH Web 签名和 `session.list` RPC，避免误连接其他本地服务
- 🔐 壁纸 IPC 仅对 DSH 页面开放，诊断日志会隐藏用户目录和常见凭据参数
- 🧾 在 Electron 用户数据目录记录有限大小的本地诊断日志和服务状态
- ⚙️ 通过注册表、`libraryfolders.vdf` 和环境变量自动检测多个 Steam 库
- 🚀 壁纸扫描有缓存和并发上限，大型场景包提取串行化，不修改 Steam 原始文件
- 🆔 壁纸 ID 基于壁纸根目录生成稳定标识；旧版按目录序号或裸 ID 的配置会自动迁移
- 🔎 壁纸面板支持搜索、视频/静态/收藏/最近筛选、收藏和当前壁纸标记
- 🗂️ 支持在应用内添加、移除和重新扫描壁纸目录
- 🔁 DSH 或渲染进程异常时自动尝试恢复，不复制会话或上下文
- 🧰 启动失败页提供脱敏诊断信息和复制按钮，便于排查本机安装/端口问题
- ✅ 启动时校验 DSH 最低版本，避免连接到不兼容的运行时
- 🧪 提供 DSH 运行诊断命令，并在 Linux/Windows CI 分别验证逻辑和 Windows 打包

## 前置要求

- **Node.js**（>= 22，用于依赖安装和打包；DSH 本身仍按其要求运行）
- **DSH 已全局安装**：`npm install -g @deepseek-ai/dsh`
- （可选）**Wallpaper Engine** + Steam 创意工坊壁纸（用于壁纸选择器）

## 快速开始

### Windows 一键安装

双击 `install.cmd`。脚本会检查 Node.js、npm 和 DSH，使用锁文件安装依赖，运行检查和测试，生成 Windows 应用，并尝试创建 `DeepSeek Harness Desktop.lnk`。

### 1. 安装依赖

```bash
npm ci
npm run check
npm test
```

检查当前 DSH 服务（只输出会话文件数量和大小，不输出会话内容或凭据）：

```bash
npm run verify
```

### 2. 开发运行

```bash
npm start
```

### 3. 打包成独立 exe

```bash
npm run pack
```

打包结果在 `release/DeepSeek Harness Desktop-win32-x64/`，双击 `DeepSeek Harness Desktop.exe` 即可运行。

应用内置 Chromium，不依赖 Edge 或 Chrome；但 DSH 命令行本身仍需单独安装，`install.cmd` 会在检测不到 `dsh` 时尝试执行 `npm install -g @deepseek-ai/dsh`。

应用退出时会结束本应用自己启动的 DSH Web 子进程，并清理对应状态文件。如果端口已经被其他服务占用，应用会拒绝误连接，不会根据端口盲目杀进程。

应用现在会先验证 3080 返回的 DSH Web 签名，再验证 `session.list` RPC。若端口被其他本地服务占用，会提示端口冲突并停止启动，不会注入壁纸脚本，也不会结束该外部进程。DSH 子进程退出或 Web 页面崩溃时，包装器会用有限次数和退避间隔尝试重连。

## 环境变量（可选覆盖）

| 变量 | 说明 | 默认 |
|---|---|---|
| `DSHGUI_NODE` | node.exe 路径 | 自动检测 |
| `DSHGUI_DSH_BIN` | dsh 的 bin.js 路径 | 自动检测（npm 全局） |
| `DSHGUI_WALLPAPER_DIR` | 单个 Wallpaper Engine 壁纸目录 | 自动检测（Steam 431960） |
| `DSHGUI_WALLPAPER_DIRS` | 多个 Wallpaper Engine 目录，用分号分隔 | 自动检测 |
| `DSHGUI_STEAM_DIR` | 单个 Steam 根目录 | 自动检测 |
| `DSHGUI_STEAM_DIRS` | 多个 Steam 根目录，用分号分隔 | 自动检测 |
| `DSHGUI_WORKSPACE` | dsh 服务工作目录 | `~/dsh-workspace` |
| `DSHGUI_PORT` | 本地 Web 端口（1024–65535） | `3080` |
| `DSHGUI_MIN_DSH_VERSION` | 允许启动的最低 DSH 版本 | `0.1.0-rc.6` |

`.env.example` 只提供变量名，不应填写密钥。应用不读取、不上传 DSH 会话、凭据或 API Key。也可以直接在右下角壁纸面板中添加目录；手动添加的目录会保存在 Electron userData 中，Steam 自动检测结果仍会在重新扫描时更新。修改最低版本后，重启应用才会生效。

## 壁纸文件解析助手

独立工具，可单独使用：

```bash
node wallpaper-helper.js [输入目录] [输出目录]
```

- 不传参数：自动检测 Steam 壁纸目录，输出到 `~/wallpaper-converted`
- 传一个壁纸文件夹：只处理那一个
- 也可以直接传入 `scene.pkg`；输出目录不能位于输入目录内部

解析器会校验包大小、条目边界、LZ4 长度和输出文件名；同名输出文件会自动改名，不会覆盖已有结果。

解析过程限制并发和输出预算：最多输出 5000 个文件、总大小 2 GiB；大场景包不会并行读入多个副本，避免占满内存或磁盘。桌面选择器只在用户选中缺少预览图的场景时提取 `scene.pkg`，不会在打开列表时批量读取大型场景包。

支持格式：PKGV 容器（0003/0012/0018/0019/0021/0022/0023/0024）、TEX 里嵌入的 MP4/JPEG/PNG、LZ4 压缩 RGBA 精灵表、音频（mp3/wav/ogg/flac）、Web 壁纸媒体。

## 目录结构

```
dshgui/
├── main.js              # Electron 主进程
├── config.js            # 路径自动检测
├── preload.js           # 渲染进程桥接
├── wallpaper-ui.js      # 壁纸选择器 UI（注入）
├── wallpaper-helper.js  # 壁纸文件解析助手
├── lib/                 # 原子写入、诊断日志、进程识别、恢复、版本和壁纸 ID 工具
├── loading.html         # 启动加载页
├── error.html           # 错误页
├── scripts/             # Windows 安装辅助脚本
├── icon.ico / icon.png  # 图标
└── package.json
```

## 本地数据和提交前检查

桌面应用自己的 `wallpaper.json`、`wallpaper-paths.json`、`dsh-server.json`、`dsh-web.log`、`protocol.log`、`inject.log` 和 `wallpaper-cache/` 位于 Electron userData 目录。诊断日志会将用户目录、Bearer 值及常见 token 参数脱敏，DSH 子进程输出也会经过同一过滤层。DSH 的会话、SQLite 搜索索引、凭据和模型配置由 DSH 保存在用户目录，均不属于本仓库。

提交前运行：

```bash
git status --short --untracked-files=all
npm run check
npm test
npm audit --audit-level=high
```

GitHub Actions 会在 push 和 pull request 上自动执行依赖安装、检查、测试和安全审计；推送与 `package.json` 版本一致的 `v*` 标签时，还会生成带 SHA256 校验文件的 Windows portable zip Release。`.gitignore` 已排除 `.dsh`、会话、SQLite、日志、缓存和 `.env` 文件。

## 许可证

MIT
