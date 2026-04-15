package web

import (
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/guohuiyuan/go-music-dl/core"
	"github.com/guohuiyuan/music-lib/model"
)

//go:embed templates/*
var templateFS embed.FS

const RoutePrefix = "/music"

type importCollectionMeta struct {
	Enabled     bool
	Name        string
	Description string
	Cover       string
	Creator     string
	TrackCount  int
	Source      string
	ExternalID  string
	Link        string
	ContentType string
	HoverText   string
}

func defaultSourcesForSearchType(searchType string) []string {
	switch searchType {
	case "playlist":
		return core.GetPlaylistSourceNames()
	case "album":
		return core.GetAlbumSourceNames()
	default:
		return core.GetDefaultSourceNames()
	}
}

func collectionLabelForSearchType(searchType string) string {
	if searchType == "album" {
		return "专辑"
	}
	return "歌单"
}

func collectionCreatorLabelForSearchType(searchType string) string {
	if searchType == "album" {
		return "歌手"
	}
	return "创建者"
}

func searchPlaceholderForType(searchType string) string {
	switch searchType {
	case "playlist":
		return "搜索歌单、创建者，或直接粘贴歌单链接"
	case "album":
		return "搜索专辑、歌手，或直接粘贴专辑链接"
	default:
		return "搜索歌曲、歌手，或直接粘贴分享链接"
	}
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		method := c.Request.Method
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, UPDATE")
		c.Header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization")
		c.Header("Access-Control-Expose-Headers", "Content-Length, Access-Control-Allow-Origin, Access-Control-Allow-Headers, Cache-Control, Content-Language, Content-Type")
		c.Header("Access-Control-Allow-Credentials", "true")
		if method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
		}
		c.Next()
	}
}

func setDownloadHeader(c *gin.Context, filename string) {
	encoded := url.QueryEscape(filename)
	encoded = strings.ReplaceAll(encoded, "+", "%20")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"; filename*=utf-8''%s", encoded, encoded))
}

func playlistExtraValue(playlist model.Playlist, key string) string {
	if playlist.Extra == nil {
		return ""
	}
	return strings.TrimSpace(playlist.Extra[key])
}

func importCollectionHoverText(contentType string) string {
	if contentType == collectionContentAlbum {
		return "导入到本地歌单列表，保存为外部导入专辑；仅保存元数据，不保存具体歌曲明细。"
	}
	return "导入到本地歌单列表，保存为外部导入歌单；仅保存元数据，不保存具体歌曲明细。"
}

func playlistDetailURL(root string, searchType string, playlist model.Playlist) string {
	if strings.TrimSpace(playlist.Source) == "local" {
		return fmt.Sprintf("%s/collection?id=%s", root, url.QueryEscape(playlist.ID))
	}

	route := "playlist"
	contentType := collectionContentPlaylist
	if searchType == collectionContentAlbum {
		route = "album"
		contentType = collectionContentAlbum
	}

	values := url.Values{}
	values.Set("id", playlist.ID)
	values.Set("source", playlist.Source)
	if name := strings.TrimSpace(playlist.Name); name != "" {
		values.Set("name", name)
	}
	if description := strings.TrimSpace(playlist.Description); description != "" {
		values.Set("description", description)
	}
	if cover := strings.TrimSpace(playlist.Cover); cover != "" {
		values.Set("cover", cover)
	}
	if creator := strings.TrimSpace(playlist.Creator); creator != "" {
		values.Set("creator", creator)
	}
	if playlist.TrackCount > 0 {
		values.Set("track_count", strconv.Itoa(playlist.TrackCount))
	}
	link := strings.TrimSpace(playlist.Link)
	if link == "" {
		link = core.GetOriginalLink(playlist.Source, playlist.ID, contentType)
	}
	if link != "" {
		values.Set("link", link)
	}

	return fmt.Sprintf("%s/%s?%s", root, route, values.Encode())
}

func renderIndex(c *gin.Context, songs []model.Song, playlists []model.Playlist, q string, selected []string, errMsg string, searchType string, playlistLink string, colID string, colName string, isLocalColPage bool, collectionKind string, importCollection *importCollectionMeta) {
	allSrc := core.GetAllSourceNames()
	desc := make(map[string]string)
	for _, s := range allSrc {
		desc[s] = core.GetSourceDescription(s)
	}

	playlistSupported := make(map[string]bool)
	for _, s := range core.GetPlaylistSourceNames() {
		playlistSupported[s] = true
	}
	albumSupported := make(map[string]bool)
	for _, s := range core.GetAlbumSourceNames() {
		albumSupported[s] = true
	}

	settings := core.GetWebSettings()
	defaultPageSize := settings.WebPageSize
	if defaultPageSize <= 0 {
		defaultPageSize = core.DefaultWebPageSize
	}
	pageSize := defaultPageSize
	if raw := strings.TrimSpace(c.Query("page_size")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			pageSize = n
		}
	}
	if pageSize > 200 {
		pageSize = 200
	}

	page := 1
	if raw := strings.TrimSpace(c.Query("page")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			page = n
		}
	}

	totalCount := 0
	if len(songs) > 0 {
		totalCount = len(songs)
	} else if len(playlists) > 0 {
		totalCount = len(playlists)
	}

	totalPages := 1
	pageStart := 0
	pageEnd := totalCount
	if totalCount > 0 {
		totalPages = (totalCount + pageSize - 1) / pageSize
		if page > totalPages {
			page = totalPages
		}
		pageStart = (page - 1) * pageSize
		if pageStart < 0 {
			pageStart = 0
		}
		pageEnd = pageStart + pageSize
		if pageEnd > totalCount {
			pageEnd = totalCount
		}

		if len(songs) > 0 {
			songs = songs[pageStart:pageEnd]
		}
		if len(playlists) > 0 {
			playlists = playlists[pageStart:pageEnd]
		}
	}

	pageStartDisplay := 0
	if totalCount > 0 {
		pageStartDisplay = pageStart + 1
	}

	c.HTML(200, "index.html", gin.H{
		"Result":             songs,
		"Playlists":          playlists,
		"Page":               page,
		"PageSize":           pageSize,
		"TotalCount":         totalCount,
		"TotalPages":         totalPages,
		"PageStart":          pageStartDisplay,
		"PageEnd":            pageEnd,
		"Keyword":            q,
		"AllSources":         allSrc,
		"DefaultSources":     defaultSourcesForSearchType(searchType),
		"SourceDescriptions": desc,
		"Selected":           selected,
		"Error":              errMsg,
		"SearchType":         searchType,
		"PlaylistSupported":  playlistSupported,
		"AlbumSupported":     albumSupported,
		"SearchPlaceholder":  searchPlaceholderForType(searchType),
		"CollectionLabel":    collectionLabelForSearchType(searchType),
		"CollectionCreator":  collectionCreatorLabelForSearchType(searchType),
		"Root":               RoutePrefix,
		"PlaylistLink":       playlistLink,
		"ColID":              colID,
		"ColName":            colName,
		"CollectionKind":     collectionKind,
		"ImportCollection":   importCollection,
		"CanRemoveSongs":     colID != "" && collectionKind == collectionKindManual,
		"IsLocalColPage":     isLocalColPage,
	})
}

func Start(port string, shouldOpenBrowser bool) {
	core.CM.Load()
	InitDB()
	defer CloseDB()

	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()
	r.Use(corsMiddleware())

	tmpl := template.Must(template.New("").Funcs(template.FuncMap{
		"artistTokens":       splitArtistTokens,
		"albumID":            songAlbumID,
		"playlistDetailURL":  playlistDetailURL,
		"playlistExtraValue": playlistExtraValue,
		"tojson": func(v interface{}) string {
			if v == nil {
				return ""
			}
			b, err := json.Marshal(v)
			if err != nil {
				return ""
			}
			return string(b)
		},
	}).ParseFS(templateFS,
		"templates/pages/*.html",
		"templates/partials/*.html",
	))
	r.SetHTMLTemplate(tmpl)

	r.GET("/", func(c *gin.Context) {
		c.Redirect(http.StatusMovedPermanently, RoutePrefix)
	})

	videoDir := "data/video_output"
	os.MkdirAll(videoDir, 0755)

	api := r.Group(RoutePrefix)
	api.Static("/videos", videoDir)

	// 鍩虹鍓嶇渚濊禆璺敱
	api.GET("/icon.png", func(c *gin.Context) { c.FileFromFS("templates/static/images/icon.png", http.FS(templateFS)) })
	api.GET("/style.css", func(c *gin.Context) { c.FileFromFS("templates/static/css/style.css", http.FS(templateFS)) })
	api.GET("/videogen.css", func(c *gin.Context) { c.FileFromFS("templates/static/css/videogen.css", http.FS(templateFS)) })
	api.GET("/videogen.js", func(c *gin.Context) { c.FileFromFS("templates/static/js/videogen.js", http.FS(templateFS)) })
	api.GET("/app.js", func(c *gin.Context) { c.FileFromFS("templates/static/js/app.js", http.FS(templateFS)) })
	api.GET("/render", func(c *gin.Context) {
		c.HTML(200, "render.html", gin.H{
			"Root": RoutePrefix,
		})
	})

	api.GET("/cookies", func(c *gin.Context) { c.JSON(200, core.CM.GetAll()) })
	api.POST("/cookies", func(c *gin.Context) {
		var req map[string]string
		if err := c.ShouldBindJSON(&req); err == nil {
			core.CM.SetAll(req)
			core.CM.Save()
			c.JSON(200, gin.H{"status": "ok"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cookies payload"})
	})

	api.GET("/settings", func(c *gin.Context) {
		c.JSON(200, core.GetWebSettings())
	})
	api.POST("/settings", func(c *gin.Context) {
		var req core.WebSettings
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid settings payload"})
			return
		}
		if err := core.SaveWebSettings(req); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, core.GetWebSettings())
	})

	// 获取可用的下载目录列表（data-share 共享目录 + 用户授权目录）
	api.GET("/authorized-dirs", func(c *gin.Context) {
		type DirInfo struct {
			Name   string `json:"name"`
			Path   string `json:"path"`
			Source string `json:"source"` // "share" 或 "authorized"
		}

		dataDir := os.Getenv("HOME")
		if dataDir == "" {
			dataDir = "."
		}

		seen := make(map[string]bool)
		var dirs []DirInfo

		// 1. 读 data-share 共享目录（安装时自动创建，始终可用）
		shareFile := filepath.Join(dataDir, ".share_paths")
		if data, err := os.ReadFile(shareFile); err == nil {
			for _, p := range strings.Split(strings.TrimSpace(string(data)), ":") {
				p = strings.TrimSpace(p)
				if p != "" && !seen[p] {
					seen[p] = true
					dirs = append(dirs, DirInfo{Name: filepath.Base(p) + "（应用共享）", Path: p, Source: "share"})
				}
			}
		}

		// 2. 读用户授权的外部目录
		accessFile := filepath.Join(dataDir, ".accessible_paths")
		if data, err := os.ReadFile(accessFile); err == nil {
			for _, p := range strings.Split(strings.TrimSpace(string(data)), ":") {
				p = strings.TrimSpace(p)
				if p != "" && !seen[p] {
					seen[p] = true
					dirs = append(dirs, DirInfo{Name: filepath.Base(p), Path: p, Source: "authorized"})
				}
			}
		}

		// 3. 回退：尝试环境变量
		if len(dirs) == 0 {
			for _, envKey := range []string{"TRIM_DATA_SHARE_PATHS", "TRIM_DATA_ACCESSIBLE_PATHS"} {
				val := os.Getenv(envKey)
				if val == "" {
					continue
				}
				for _, p := range strings.Split(val, ":") {
					p = strings.TrimSpace(p)
					if p != "" && !seen[p] {
						seen[p] = true
						dirs = append(dirs, DirInfo{Name: filepath.Base(p), Path: p, Source: "env"})
					}
				}
			}
		}

		c.JSON(200, gin.H{
			"dirs":       dirs,
			"shareFile":  shareFile,
			"accessFile": accessFile,
			"home":       dataDir,
		})
	})

	RegisterMusicRoutes(api)
	RegisterCollectionRoutes(api)
	RegisterVideogenRoutes(api, videoDir)

	urlStr := "http://localhost:" + port + RoutePrefix
	fmt.Printf("Web started at %s\n", urlStr)
	if shouldOpenBrowser {
		go func() { time.Sleep(500 * time.Millisecond); core.OpenBrowser(urlStr) }()
	}
	r.Run(":" + port)
}
