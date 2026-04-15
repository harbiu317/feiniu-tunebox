package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/guohuiyuan/go-music-dl/internal/cli"
)

// 全局配置变量
var (
	showVersion bool
	keyword     string
	urlStr      string
	sources     []string
	outDir      string
	withCover   bool
	withLyrics  bool
)

var rootCmd = &cobra.Command{
	Use:   "music-dl",
	Short: "聚合音乐搜索下载工具 (支持多源/TUI/Web/封面/歌词)",
	Long: `Go Music DL 是一个基于命令行的聚合音乐搜索和下载工具。

支持的音乐源:
  - netease   (网易云音乐)
  - qq        (QQ音乐)
  - kugou     (酷狗音乐)
  - kuwo      (酷我音乐)
  - migu      (咪咕音乐)
  - qianqian  (千千音乐)
  - soda      (汽水音乐)
  - fivesing  (5sing原创)
  - ... 以及 jamendo, joox, bilibili 等

特性:
  - TUI 交互式界面，支持空格多选
  - Web 网页版界面 (使用 'music-dl web' 启动)
  - 支持下载高品质音频 (部分源支持无损)
  - 自动下载封面图片 (需开启 --cover)
  - 自动下载 LRC 歌词 (需开启 --lyrics)`,
	Example: `  # 1. 基础搜索 (默认搜索所有源)
  music-dl -k "周杰伦"

  # 2. 指定源搜索 (例如：只搜网易云和QQ)
  music-dl -k "林俊杰" -s netease,qq

  # 3. 全功能下载 (指定目录 + 封面 + 歌词)
  music-dl -k "陈奕迅" -o "MyMusic" --cover --lyrics

  # 4. 启动 Web 界面
  music-dl web

  # 5. 直接进入 TUI 交互模式 (不带参数)
  music-dl`,
	Run: func(cmd *cobra.Command, args []string) {
		if showVersion {
			fmt.Println("music-dl version v1.3.1 (TUI Version)")
			return
		}

		// [修正] 默认目录设为 "downloads" 而不是 "."
		if outDir == "" {
			outDir = "downloads"
		}

		// 确保目录存在
		if _, err := os.Stat(outDir); os.IsNotExist(err) {
			_ = os.MkdirAll(outDir, 0755)
		}

		// 如果有 URL (功能未完成，先保留提示)
		if urlStr != "" {
			fmt.Println("🚀 URL 下载功能开发中: ", urlStr)
			return
		}

		// 启动 TUI 界面
		cli.StartUI(keyword, sources, outDir, withCover, withLyrics)
	},
}

func init() {
	// 绑定 Flags
	rootCmd.Flags().BoolVarP(&showVersion, "version", "v", false, "显示版本信息")
	rootCmd.Flags().StringVarP(&keyword, "keyword", "k", "", "搜索关键字")
	rootCmd.Flags().StringVarP(&urlStr, "url", "u", "", "通过指定的歌曲URL下载音乐 (开发中)")

	// [优化] 明确提示可用源
	rootCmd.Flags().StringSliceVarP(&sources, "sources", "s", []string{}, "指定搜索源，用逗号分隔 (e.g. netease,qq,kugou)")

	rootCmd.Flags().StringVarP(&outDir, "outdir", "o", "data/downloads", "指定下载目录")
	rootCmd.Flags().BoolVar(&withCover, "cover", true, "同时下载封面图片 (默认开启，使用 --cover=false 关闭)")
	rootCmd.Flags().BoolVarP(&withLyrics, "lyrics", "l", true, "同时下载歌词 (默认开启，使用 --lyrics=false 关闭)")
}
