# DSH GUI

把 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（DSH）网页版包装成**独立桌面应用**，并附带两个实用工具：

1. **壁纸选择器**：在应用内直接选择 Wallpaper Engine 壁纸作为背景（与桌面壁纸独立）。
2. **壁纸文件解析助手**：把 Wallpaper Engine 的非标准格式（PKGV 场景包、TEX 纹理里嵌入的图片/视频/LZ4 精灵表）转成常见格式（mp4 / png / jpg）。

## 特性

- 🖥️ 独立桌面窗口（Electron，自带 Chromium，不依赖 Edge/Chrome）
- 🐋 自带 DeepSeek 图标
- 🎨 应用内壁纸选择器（右下角按钮），支持视频壁纸、静态壁纸、多层场景图层
- 🔧 自动从 Wallpaper Engine 场景包提取高清图/视频（含 LZ4 压缩精灵表解码）
- ⚙️ 自动检测路径，无需手动配置（也可用环境变量覆盖）

## 前置要求

- **Node.js**（>= 18）
- **DSH 已全局安装**：`npm install -g @deepseek-ai/dsh`
- （可选）**Wallpaper Engine** + Steam 创意工坊壁纸（用于壁纸选择器）

## 快速开始

### Windows 一键安装

双击 `install.cmd`。脚本会检查 Node.js，按需安装 DSH，安装 Electron 依赖，生成 Windows 应用，并尝试在桌面创建 `DeepSeek Harness.lnk`。

### 1. 安装依赖

```bash
npm install
```

### 2. 开发运行

```bash
npm start
```

### 3. 打包成独立 exe

```bash
npm run pack
```

打包结果在 `release/DeepSeek Harness-win32-x64/`，双击 `DeepSeek Harness.exe` 即可运行。

应用内置 Chromium，不依赖 Edge 或 Chrome；但 DSH 命令行本身仍需单独安装，`install.cmd` 会在检测不到 `dsh` 时尝试执行 `npm install -g @deepseek-ai/dsh`。

## 环境变量（可选覆盖）

| 变量 | 说明 | 默认 |
|---|---|---|
| `DSHGUI_NODE` | node.exe 路径 | 自动检测 |
| `DSHGUI_DSH_BIN` | dsh 的 bin.js 路径 | 自动检测（npm 全局） |
| `DSHGUI_WALLPAPER_DIR` | Wallpaper Engine 壁纸目录 | 自动检测（Steam 431960） |
| `DSHGUI_WORKSPACE` | dsh 服务工作目录 | 用户主目录 |

## 壁纸文件解析助手

独立工具，可单独使用：

```bash
node wallpaper-helper.js [输入目录] [输出目录]
```

- 不传参数：自动检测 Steam 壁纸目录，输出到 `~/wallpaper-converted`
- 传一个壁纸文件夹：只处理那一个

支持格式：PKGV 容器（0003/0012/0018/0019/0021/0022/0023/0024）、TEX 里嵌入的 MP4/JPEG/PNG、LZ4 压缩 RGBA 精灵表、音频（mp3/wav/ogg/flac）、Web 壁纸媒体。

## 目录结构

```
dshgui/
├── main.js              # Electron 主进程
├── config.js            # 路径自动检测
├── preload.js           # 渲染进程桥接
├── wallpaper-ui.js      # 壁纸选择器 UI（注入）
├── wallpaper-helper.js  # 壁纸文件解析助手
├── loading.html         # 启动加载页
├── error.html           # 错误页
├── scripts/             # Windows 安装辅助脚本
├── icon.ico / icon.png  # 图标
└── package.json
```

## 许可证

MIT
