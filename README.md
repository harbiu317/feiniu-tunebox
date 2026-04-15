# Tunebox（feiniu-tunebox）

> 聚合音乐搜索与下载工具的 **飞牛 NAS（fnOS）应用版**，基于 Go 开发，提供 Web 界面进行多平台音乐搜索、在线试听、无损下载、歌词与封面获取、歌单/专辑管理。

![首页](docs/screenshots/01-home.png)

## 来源仓库

本项目基于开源项目 **[guohuiyuan/go-music-dl](https://github.com/guohuiyuan/go-music-dl)** 二次开发，主要改造内容：

- 移植为飞牛 NAS（fnOS）原生应用，提供 `.fpk` 安装包
- 完善 Web UI（设计风格、歌单管理、播放器、下载选项等）
- 适配 fnOS 的 service/wizard/权限体系

原始核心解析能力来自上游，感谢原作者的工作。

## 功能特性

- **多平台聚合搜索**：网易云音乐、QQ 音乐、酷狗、酷我、咪咕、5sing、千千、汽水、JOOX、Jamendo、Bilibili
- **单曲 / 歌单 / 专辑**三种搜索模式，支持直接粘贴分享链接
- **Web 试听**：内置播放器，支持换源、连续播放
- **无损下载**：支持 FLAC、320kbps 等多音质，自动下载歌词与封面
- **本地歌单**：可将在线歌单导入为本地自制歌单，便于管理
- **每日推荐**：聚合各平台推荐歌单入口

## 截图

| 首页 / 搜索源设置 | 歌单浏览 |
|---|---|
| ![](docs/screenshots/01-home.png) | ![](docs/screenshots/02-playlist.png) |
| **单曲搜索结果** | **下载设置** |
| ![](docs/screenshots/03-song-search.png) | ![](docs/screenshots/04-settings.png) |

## 安装（飞牛 NAS）

1. 到 [Releases](../../releases) 下载最新的 `tunebox_x.y.z_x86.fpk`
2. 打开飞牛 NAS 应用中心 → 手动安装 → 选择下载的 `.fpk` 文件
3. 安装完成后打开 Tunebox 即可使用

系统要求：fnOS ≥ 1.1.8，x86_64 架构

## 源码构建

```bash
# 构建 Go 二进制
go build -o dist/tunebox ./cmd/music-dl

# 构建飞牛 fpk 安装包
bash build-fpk.sh
```

> fpk 打包依赖 `fnpack` 工具，详见飞牛官方文档。

## 目录结构

```
cmd/music-dl/     — 入口（CLI + Web 服务）
core/             — 下载 / 服务核心
internal/cli/     — 命令行实现
internal/web/     — Web 服务与前端资源
fnos/             — 飞牛应用打包元数据（manifest、service、UI）
scripts/          — 辅助脚本
docs/             — 文档与截图
```

## 许可证

继承上游项目的开源许可证，详见 [LICENSE](LICENSE)。

仅供学习与个人使用，请勿用于商业用途；所有音乐版权归原平台及版权方所有。
