package core

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/dhowden/tag"
	"github.com/guohuiyuan/music-lib/bilibili"
	"github.com/guohuiyuan/music-lib/fivesing"
	"github.com/guohuiyuan/music-lib/jamendo"
	"github.com/guohuiyuan/music-lib/joox"
	"github.com/guohuiyuan/music-lib/kugou"
	"github.com/guohuiyuan/music-lib/kuwo"
	"github.com/guohuiyuan/music-lib/migu"
	"github.com/guohuiyuan/music-lib/model"
	"github.com/guohuiyuan/music-lib/netease"
	"github.com/guohuiyuan/music-lib/qianqian"
	"github.com/guohuiyuan/music-lib/qq"
	"github.com/guohuiyuan/music-lib/soda"
	"gorm.io/gorm"
)

var ErrFFmpegNotFound = errors.New("ffmpeg not found")

const (
	UA_Common    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
	UA_Mobile    = "Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1"
	Ref_Bilibili = "https://www.bilibili.com/"
	Ref_Migu     = "http://music.migu.cn/"
	CookieFile   = "data/cookies.json"
)

// ==========================================
// Cookie 管理系统
// ==========================================

type CookieManager struct {
	mu      sync.RWMutex
	cookies map[string]string
}

var CM = &CookieManager{cookies: make(map[string]string)}

func (m *CookieManager) Load() {
	if err := ensureConfigDB(); err != nil {
		return
	}

	var rows []cookieEntry
	if err := configDB.Order("source ASC").Find(&rows).Error; err != nil {
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	m.cookies = make(map[string]string, len(rows))
	for _, row := range rows {
		m.cookies[row.Source] = row.Value
	}
}

func (m *CookieManager) Save() {
	if err := ensureConfigDB(); err != nil {
		return
	}

	m.mu.RLock()
	rows := make([]cookieEntry, 0, len(m.cookies))
	for source, value := range m.cookies {
		source = strings.TrimSpace(source)
		value = strings.TrimSpace(value)
		if source == "" || value == "" {
			continue
		}
		rows = append(rows, cookieEntry{Source: source, Value: value})
	}
	m.mu.RUnlock()

	_ = configDB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("1 = 1").Delete(&cookieEntry{}).Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		return tx.Create(&rows).Error
	})
	// 🌟 确保写入前目录存在
	os.MkdirAll("data", 0755)
}

func (m *CookieManager) Get(source string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.cookies[source]
}

func (m *CookieManager) SetAll(c map[string]string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for k, v := range c {
		if v == "" {
			delete(m.cookies, k)
		} else {
			m.cookies[k] = v
		}
	}
}

func (m *CookieManager) GetAll() map[string]string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	res := make(map[string]string)
	for k, v := range m.cookies {
		res[k] = v
	}
	return res
}

// ==========================================
// 工厂函数映射
// ==========================================

type SearchFunc func(keyword string) ([]model.Song, error)
type SearchPlaylistFunc func(keyword string) ([]model.Playlist, error)

func GetSearchFunc(source string) SearchFunc {
	c := CM.Get(source)
	switch source {
	case "netease":
		return netease.New(c).Search
	case "qq":
		return qq.New(c).Search
	case "kugou":
		return kugou.New(c).Search
	case "kuwo":
		return kuwo.New(c).Search
	case "migu":
		return migu.New(c).Search
	case "bilibili":
		return bilibili.New(c).Search
	case "fivesing":
		return fivesing.New(c).Search
	case "jamendo":
		return jamendo.New(c).Search
	case "joox":
		return joox.New(c).Search
	case "qianqian":
		return qianqian.New(c).Search
	case "soda":
		return soda.New(c).Search
	default:
		return nil
	}
}

func GetAlbumSearchFunc(source string) SearchPlaylistFunc {
	c := CM.Get(source)
	switch source {
	case "netease":
		return netease.New(c).SearchAlbum
	case "qq":
		return qq.New(c).SearchAlbum
	case "kugou":
		return kugou.New(c).SearchAlbum
	case "kuwo":
		return kuwo.New(c).SearchAlbum
	case "migu":
		return migu.New(c).SearchAlbum
	case "jamendo":
		return jamendo.New(c).SearchAlbum
	case "joox":
		return joox.New(c).SearchAlbum
	case "qianqian":
		return qianqian.New(c).SearchAlbum
	case "soda":
		return soda.New(c).SearchAlbum
	default:
		return nil
	}
}

func GetPlaylistSearchFunc(source string) SearchPlaylistFunc {
	c := CM.Get(source)
	switch source {
	case "netease":
		return netease.New(c).SearchPlaylist
	case "qq":
		return qq.New(c).SearchPlaylist
	case "kugou":
		return kugou.New(c).SearchPlaylist
	case "kuwo":
		return kuwo.New(c).SearchPlaylist
	case "bilibili":
		return bilibili.New(c).SearchPlaylist
	case "soda":
		return soda.New(c).SearchPlaylist
	case "fivesing":
		return fivesing.New(c).SearchPlaylist
	default:
		return nil
	}
}

func GetAlbumDetailFunc(source string) func(string) ([]model.Song, error) {
	c := CM.Get(source)
	switch source {
	case "netease":
		return netease.New(c).GetAlbumSongs
	case "qq":
		return qq.New(c).GetAlbumSongs
	case "kugou":
		return kugou.New(c).GetAlbumSongs
	case "kuwo":
		return kuwo.New(c).GetAlbumSongs
	case "migu":
		return migu.New(c).GetAlbumSongs
	case "jamendo":
		return jamendo.New(c).GetAlbumSongs
	case "joox":
		return joox.New(c).GetAlbumSongs
	case "qianqian":
		return qianqian.New(c).GetAlbumSongs
	case "soda":
		return soda.New(c).GetAlbumSongs
	default:
		return nil
	}
}

func GetPlaylistDetailFunc(source string) func(string) ([]model.Song, error) {
	c := CM.Get(source)
	switch source {
	case "netease":
		return netease.New(c).GetPlaylistSongs
	case "qq":
		return qq.New(c).GetPlaylistSongs
	case "kugou":
		return kugou.New(c).GetPlaylistSongs
	case "kuwo":
		return kuwo.New(c).GetPlaylistSongs
	case "bilibili":
		return bilibili.New(c).GetPlaylistSongs
	case "soda":
		return soda.New(c).GetPlaylistSongs
	case "fivesing":
		return fivesing.New(c).GetPlaylistSongs
	default:
		return nil
	}
}

func GetRecommendFunc(source string) func() ([]model.Playlist, error) {
	c := CM.Get(source)
	switch source {
	case "netease":
		return netease.New(c).GetRecommendedPlaylists
	case "qq":
		return qq.New(c).GetRecommendedPlaylists
	case "kugou":
		return kugou.New(c).GetRecommendedPlaylists
	case "kuwo":
		return kuwo.New(c).GetRecommendedPlaylists
	default:
		return nil
	}
}

func GetDownloadFunc(source string) func(*model.Song) (string, error) {
	c := CM.Get(source)
	switch source {
	case "netease":
		return netease.New(c).GetDownloadURL
	case "qq":
		return qq.New(c).GetDownloadURL
	case "kugou":
		return kugou.New(c).GetDownloadURL
	case "kuwo":
		return kuwo.New(c).GetDownloadURL
	case "migu":
		return migu.New(c).GetDownloadURL
	case "soda":
		return soda.New(c).GetDownloadURL
	case "bilibili":
		return bilibili.New(c).GetDownloadURL
	case "fivesing":
		return fivesing.New(c).GetDownloadURL
	case "jamendo":
		return jamendo.New(c).GetDownloadURL
	case "joox":
		return joox.New(c).GetDownloadURL
	case "qianqian":
		return qianqian.New(c).GetDownloadURL
	default:
		return nil
	}
}

func GetLyricFunc(source string) func(*model.Song) (string, error) {
	c := CM.Get(source)
	switch source {
	case "netease":
		return netease.New(c).GetLyrics
	case "qq":
		return qq.New(c).GetLyrics
	case "kugou":
		return kugou.New(c).GetLyrics
	case "kuwo":
		return kuwo.New(c).GetLyrics
	case "migu":
		return migu.New(c).GetLyrics
	case "soda":
		return soda.New(c).GetLyrics
	case "bilibili":
		return bilibili.New(c).GetLyrics
	case "fivesing":
		return fivesing.New(c).GetLyrics
	case "jamendo":
		return jamendo.New(c).GetLyrics
	case "joox":
		return joox.New(c).GetLyrics
	case "qianqian":
		return qianqian.New(c).GetLyrics
	default:
		return nil
	}
}

func GetParseFunc(source string) func(string) (*model.Song, error) {
	c := CM.Get(source)
	switch source {
	case "netease":
		return netease.New(c).Parse
	case "qq":
		return qq.New(c).Parse
	case "kugou":
		return kugou.New(c).Parse
	case "kuwo":
		return kuwo.New(c).Parse
	case "migu":
		return migu.New(c).Parse
	case "soda":
		return soda.New(c).Parse
	case "bilibili":
		return bilibili.New(c).Parse
	case "fivesing":
		return fivesing.New(c).Parse
	case "jamendo":
		return jamendo.New(c).Parse
	default:
		return nil
	}
}

func GetParsePlaylistFunc(source string) func(string) (*model.Playlist, []model.Song, error) {
	c := CM.Get(source)
	switch source {
	case "netease":
		return netease.New(c).ParsePlaylist
	case "qq":
		return qq.New(c).ParsePlaylist
	case "kugou":
		return kugou.New(c).ParsePlaylist
	case "kuwo":
		return kuwo.New(c).ParsePlaylist
	case "bilibili":
		return bilibili.New(c).ParsePlaylist
	case "soda":
		return soda.New(c).ParsePlaylist
	case "fivesing":
		return fivesing.New(c).ParsePlaylist
	default:
		return nil
	}
}

func GetParseAlbumFunc(source string) func(string) (*model.Playlist, []model.Song, error) {
	c := CM.Get(source)
	switch source {
	case "netease":
		return netease.New(c).ParseAlbum
	case "qq":
		return qq.New(c).ParseAlbum
	case "kugou":
		return kugou.New(c).ParseAlbum
	case "kuwo":
		return kuwo.New(c).ParseAlbum
	case "migu":
		return migu.New(c).ParseAlbum
	case "jamendo":
		return jamendo.New(c).ParseAlbum
	case "joox":
		return joox.New(c).ParseAlbum
	case "qianqian":
		return qianqian.New(c).ParseAlbum
	case "soda":
		return soda.New(c).ParseAlbum
	default:
		return nil
	}
}

// ==========================================
// 辅助与解析方法
// ==========================================

func DetectSource(link string) string {
	if strings.Contains(link, "163.com") {
		return "netease"
	}
	if strings.Contains(link, "qq.com") {
		return "qq"
	}
	if strings.Contains(link, "5sing") {
		return "fivesing"
	}
	if strings.Contains(link, "kugou.com") {
		return "kugou"
	}
	if strings.Contains(link, "kuwo.cn") {
		return "kuwo"
	}
	if strings.Contains(link, "migu.cn") {
		return "migu"
	}
	if strings.Contains(link, "joox.com") {
		return "joox"
	}
	if strings.Contains(link, "bilibili.com") || strings.Contains(link, "b23.tv") {
		return "bilibili"
	}
	if strings.Contains(link, "douyin.com") || strings.Contains(link, "qishui") {
		return "soda"
	}
	if strings.Contains(link, "91q.com") {
		return "qianqian"
	}
	if strings.Contains(link, "jamendo.com") {
		return "jamendo"
	}
	return ""
}

func GetOriginalLink(source, id, typeStr string) string {
	switch source {
	case "netease":
		if typeStr == "album" {
			return "https://music.163.com/#/album?id=" + id
		}
		if typeStr == "playlist" {
			return "https://music.163.com/#/playlist?id=" + id
		}
		return "https://music.163.com/#/song?id=" + id
	case "qq":
		if typeStr == "album" {
			return "https://y.qq.com/n/ryqq/albumDetail/" + id
		}
		if typeStr == "playlist" {
			return "https://y.qq.com/n/ryqq/playlist/" + id
		}
		return "https://y.qq.com/n/ryqq/songDetail/" + id
	case "kugou":
		if typeStr == "album" {
			return "https://www.kugou.com/album/" + id + ".html"
		}
		if typeStr == "playlist" {
			return "https://www.kugou.com/yy/special/single/" + id + ".html"
		}
		return "https://www.kugou.com/song/#hash=" + id
	case "kuwo":
		if typeStr == "album" {
			return "http://www.kuwo.cn/album_detail/" + id
		}
		if typeStr == "playlist" {
			return "http://www.kuwo.cn/playlist_detail/" + id
		}
		return "http://www.kuwo.cn/play_detail/" + id
	case "migu":
		if typeStr == "album" {
			return "https://music.migu.cn/v3/music/album/" + id
		}
		if typeStr == "song" {
			return "https://music.migu.cn/v3/music/song/" + id
		}
	case "jamendo":
		if typeStr == "album" {
			return "https://www.jamendo.com/album/" + id
		}
	case "joox":
		if typeStr == "album" {
			return "https://www.joox.com/hk/album/" + id
		}
	case "qianqian":
		if typeStr == "album" {
			return "https://music.91q.com/album/" + id
		}
	case "soda":
		if typeStr == "album" {
			return "https://www.qishui.com/share/album?album_id=" + id
		}
	case "bilibili":
		return "https://www.bilibili.com/video/" + id
	case "fivesing":
		if strings.Contains(id, "/") {
			return "http://5sing.kugou.com/" + id + ".html"
		}
	}
	return ""
}

func BuildSourceRequest(method, urlStr, source, rangeHeader string) (*http.Request, error) {
	req, err := http.NewRequest(method, urlStr, nil)
	if err != nil {
		return nil, err
	}
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	req.Header.Set("User-Agent", UA_Common)
	if source == "bilibili" {
		req.Header.Set("Referer", Ref_Bilibili)
	}
	if source == "migu" {
		req.Header.Set("User-Agent", UA_Mobile)
		req.Header.Set("Referer", Ref_Migu)
	}
	if source == "qq" {
		req.Header.Set("Referer", "http://y.qq.com")
	}
	if cookie := CM.Get(source); cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	return req, nil
}

func ValidatePlayable(song *model.Song) bool {
	if song == nil || song.ID == "" || song.Source == "" {
		return false
	}
	if song.Source == "soda" || song.Source == "fivesing" {
		return false
	}
	fn := GetDownloadFunc(song.Source)
	if fn == nil {
		return false
	}
	urlStr, err := fn(&model.Song{ID: song.ID, Source: song.Source})
	if err != nil || urlStr == "" {
		return false
	}

	req, err := BuildSourceRequest("GET", urlStr, song.Source, "bytes=0-1")
	if err != nil {
		return false
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200 || resp.StatusCode == 206
}

// ==========================================
// 算法与通用工具
// ==========================================

func FormatSize(s int64) string {
	if s <= 0 {
		return "-"
	}
	return fmt.Sprintf("%.1f MB", float64(s)/1024/1024)
}

func DetectAudioExt(data []byte) string {
	if len(data) >= 16 && bytes.Equal(data[:16], []byte{0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11, 0xA6, 0xD9, 0x00, 0xAA, 0x00, 0x62, 0xCE, 0x6C}) {
		return "wma"
	}
	if len(data) >= 4 && bytes.Equal(data[:4], []byte{'f', 'L', 'a', 'C'}) {
		return "flac"
	}
	if len(data) >= 3 && bytes.Equal(data[:3], []byte{'I', 'D', '3'}) {
		return "mp3"
	}
	if len(data) >= 2 && data[0] == 0xFF && (data[1]&0xE0) == 0xE0 {
		return "mp3"
	}
	if len(data) >= 4 && bytes.Equal(data[:4], []byte{'O', 'g', 'g', 'S'}) {
		return "ogg"
	}
	if len(data) >= 12 && bytes.Equal(data[4:8], []byte{'f', 't', 'y', 'p'}) {
		return "m4a"
	}
	return "mp3"
}

func DetectAudioExtByContentType(contentType string) string {
	contentType = strings.TrimSpace(strings.ToLower(contentType))
	if idx := strings.Index(contentType, ";"); idx >= 0 {
		contentType = strings.TrimSpace(contentType[:idx])
	}

	switch contentType {
	case "audio/flac", "audio/x-flac":
		return "flac"
	case "audio/x-ms-wma", "audio/wma", "video/x-ms-asf", "application/vnd.ms-asf":
		return "wma"
	case "audio/mpeg", "audio/mp3", "audio/x-mp3":
		return "mp3"
	case "audio/ogg", "application/ogg":
		return "ogg"
	case "audio/mp4", "audio/x-m4a", "audio/aac", "audio/aacp":
		return "m4a"
	default:
		return ""
	}
}

func AudioMimeByExt(ext string) string {
	switch strings.ToLower(strings.TrimSpace(ext)) {
	case "wma":
		return "audio/x-ms-wma"
	case "flac":
		return "audio/flac"
	case "ogg":
		return "audio/ogg"
	case "m4a":
		return "audio/mp4"
	default:
		return "audio/mpeg"
	}
}

func IsDurationClose(a, b int) bool {
	if a <= 0 || b <= 0 {
		return true
	}
	diff := IntAbs(a - b)
	if diff <= 10 {
		return true
	}
	maxAllowed := int(float64(a) * 0.15)
	if maxAllowed < 10 {
		maxAllowed = 10
	}
	return diff <= maxAllowed
}

func IntAbs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func CalcSongSimilarity(name, artist, candName, candArtist string) float64 {
	nameA := NormalizeText(name)
	nameB := NormalizeText(candName)
	if nameA == "" || nameB == "" {
		return 0
	}
	nameSim := SimilarityScore(nameA, nameB)

	artistA := NormalizeText(artist)
	artistB := NormalizeText(candArtist)
	if artistA == "" || artistB == "" {
		return nameSim
	}

	artistSim := SimilarityScore(artistA, artistB)
	return nameSim*0.7 + artistSim*0.3
}

func NormalizeText(s string) string {
	if s == "" {
		return ""
	}
	s = strings.ToLower(s)
	var b strings.Builder
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsNumber(r) || unicode.In(r, unicode.Han) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func SimilarityScore(a, b string) float64 {
	if a == b {
		return 1
	}
	if a == "" || b == "" {
		return 0
	}
	la := len([]rune(a))
	lb := len([]rune(b))
	maxLen := la
	if lb > maxLen {
		maxLen = lb
	}
	if maxLen == 0 {
		return 0
	}
	dist := LevenshteinDistance(a, b)
	if dist >= maxLen {
		return 0
	}
	return 1 - float64(dist)/float64(maxLen)
}

func LevenshteinDistance(a, b string) int {
	ra := []rune(a)
	rb := []rune(b)
	la := len(ra)
	lb := len(rb)
	if la == 0 {
		return lb
	}
	if lb == 0 {
		return la
	}

	prev := make([]int, lb+1)
	cur := make([]int, lb+1)
	for j := 0; j <= lb; j++ {
		prev[j] = j
	}
	for i := 1; i <= la; i++ {
		cur[0] = i
		for j := 1; j <= lb; j++ {
			cost := 0
			if ra[i-1] != rb[j-1] {
				cost = 1
			}
			del := prev[j] + 1
			ins := cur[j-1] + 1
			sub := prev[j-1] + cost
			cur[j] = del
			if ins < cur[j] {
				cur[j] = ins
			}
			if sub < cur[j] {
				cur[j] = sub
			}
		}
		prev, cur = cur, prev
	}
	return prev[lb]
}

func OpenBrowser(url string) {
	var cmd string
	var args []string
	switch runtime.GOOS {
	case "windows":
		cmd, args = "cmd", []string{"/c", "start"}
	case "darwin":
		cmd = "open"
	default:
		cmd = "xdg-open"
	}
	args = append(args, url)
	_ = exec.Command(cmd, args...).Start()
}

func GetAllSourceNames() []string {
	return []string{"netease", "qq", "kugou", "kuwo", "migu", "fivesing", "jamendo", "joox", "qianqian", "soda", "bilibili"}
}

func GetPlaylistSourceNames() []string {
	return []string{"netease", "qq", "kugou", "kuwo", "bilibili", "soda", "fivesing"}
}

func GetAlbumSourceNames() []string {
	return []string{"netease", "qq", "kugou", "kuwo", "migu", "jamendo", "joox", "qianqian", "soda"}
}

func GetDefaultSourceNames() []string {
	allSources := GetAllSourceNames()
	var defaultSources []string
	excluded := map[string]bool{"bilibili": true, "joox": true, "jamendo": true, "fivesing": true}
	for _, source := range allSources {
		if !excluded[source] {
			defaultSources = append(defaultSources, source)
		}
	}
	return defaultSources
}

func GetSourceDescription(source string) string {
	descriptions := map[string]string{
		"netease":  "网易云音乐",
		"qq":       "QQ音乐",
		"kugou":    "酷狗音乐",
		"kuwo":     "酷我音乐",
		"migu":     "咪咕音乐",
		"fivesing": "5sing",
		"jamendo":  "Jamendo (CC)",
		"joox":     "JOOX",
		"qianqian": "千千音乐",
		"soda":     "汽水音乐",
		"bilibili": "Bilibili",
	}
	if desc, exists := descriptions[source]; exists {
		return desc
	}
	return "未知音乐源"
}

// ==========================================
// ID3v2 元数据内嵌（支持 Web & CLI 下载）
// ==========================================

func stripID3v2Prefix(audioData []byte) []byte {
	if len(audioData) < 10 || string(audioData[:3]) != "ID3" {
		return audioData
	}
	tagSize := int(audioData[6]&0x7F)<<21 | int(audioData[7]&0x7F)<<14 | int(audioData[8]&0x7F)<<7 | int(audioData[9]&0x7F)
	total := 10 + tagSize
	if audioData[5]&0x10 != 0 {
		total += 10
	}
	if total <= 0 || total > len(audioData) {
		return audioData
	}
	return audioData[total:]
}

func normalizeCoverMime(coverMime string) string {
	coverMime = strings.TrimSpace(strings.ToLower(coverMime))
	if coverMime == "" {
		return "image/jpeg"
	}
	if strings.Contains(coverMime, "png") {
		return "image/png"
	}
	if strings.Contains(coverMime, "webp") {
		return "image/webp"
	}
	if strings.Contains(coverMime, "gif") {
		return "image/gif"
	}
	return "image/jpeg"
}

func FetchBytesWithMime(urlStr string, source string) ([]byte, string, error) {
	req, err := BuildSourceRequest("GET", urlStr, source, "")
	if err != nil {
		return nil, "", err
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}

	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if contentType == "" && len(data) > 0 {
		contentType = http.DetectContentType(data)
	}

	if idx := strings.Index(contentType, ";"); idx >= 0 {
		contentType = strings.TrimSpace(contentType[:idx])
	}

	return data, contentType, nil
}

func EmbedSongMetadata(audioData []byte, song *model.Song, lyric string, coverData []byte, coverMime string) ([]byte, error) {
	if len(audioData) == 0 {
		return nil, errors.New("empty audio data")
	}

	ext := DetectAudioExt(audioData)
	if song != nil && song.Ext != "" {
		songExt := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(song.Ext, ".")))
		switch songExt {
		case "mp3", "flac", "m4a", "wma":
			ext = songExt
		}
	}

	title := ""
	artist := ""
	if song != nil {
		title = strings.TrimSpace(song.Name)
		artist = strings.TrimSpace(song.Artist)
	}
	lyric = strings.TrimSpace(lyric)

	if ext != "mp3" && ext != "flac" && ext != "m4a" && ext != "wma" {
		return audioData, nil
	}
	if title == "" && artist == "" && lyric == "" && len(coverData) == 0 {
		return audioData, nil
	}

	_, _ = tag.ReadFrom(bytes.NewReader(audioData))

	return embedAudioMetadataByFFmpeg(audioData, ext, title, artist, lyric, coverData, normalizeCoverMime(coverMime))
}

func embedAudioMetadataByFFmpeg(audioData []byte, ext, title, artist, lyric string, coverData []byte, coverMime string) ([]byte, error) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return nil, ErrFFmpegNotFound
	}

	inFile, err := os.CreateTemp("", "gomusicdl-in-*"+"."+ext)
	if err != nil {
		return nil, err
	}
	inPath := inFile.Name()
	defer os.Remove(inPath)
	if _, err := inFile.Write(audioData); err != nil {
		inFile.Close()
		return nil, err
	}
	inFile.Close()

	outFile, err := os.CreateTemp("", "gomusicdl-out-*"+"."+ext)
	if err != nil {
		return nil, err
	}
	outPath := outFile.Name()
	outFile.Close()
	defer os.Remove(outPath)

	args := []string{"-y", "-hide_banner", "-loglevel", "error", "-i", inPath}

	hasCover := len(coverData) > 0
	coverPath := ""
	if hasCover {
		coverExt := ".jpg"
		if strings.Contains(coverMime, "png") {
			coverExt = ".png"
		}
		coverFile, err := os.CreateTemp("", "gomusicdl-cover-*"+coverExt)
		if err != nil {
			return nil, err
		}
		coverPath = coverFile.Name()
		defer os.Remove(coverPath)
		if _, err := coverFile.Write(coverData); err != nil {
			coverFile.Close()
			return nil, err
		}
		coverFile.Close()
		args = append(args, "-i", coverPath)
	}

	if hasCover {
		args = append(args, "-map", "0:a:0", "-map", "1:v:0")
	} else {
		args = append(args, "-map", "0:a:0")
	}

	args = append(args, "-c:a", "copy")
	if hasCover {
		args = append(args, "-c:v", "copy", "-disposition:v:0", "attached_pic", "-metadata:s:v:0", "title=Album cover", "-metadata:s:v:0", "comment=Cover (front)")
	}

	if title != "" {
		args = append(args, "-metadata", "title="+title)
	}
	if artist != "" {
		args = append(args, "-metadata", "artist="+artist)
	}
	if lyric != "" {
		args = append(args, "-metadata", "lyrics="+lyric)
	}

	if ext == "mp3" {
		args = append(args, "-id3v2_version", "3", "-write_id3v1", "1")
	}

	args = append(args, outPath)

	cmd := exec.Command("ffmpeg", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("ffmpeg metadata embed failed: %v, output: %s", err, strings.TrimSpace(string(out)))
	}

	finalData, err := os.ReadFile(filepath.Clean(outPath))
	if err != nil {
		return nil, err
	}
	if len(finalData) == 0 {
		return nil, errors.New("embedded output is empty")
	}

	return finalData, nil
}
