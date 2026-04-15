package core

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/guohuiyuan/music-lib/model"
	"github.com/guohuiyuan/music-lib/soda"
	"github.com/guohuiyuan/music-lib/utils"
)

type DownloadedSong struct {
	Data        []byte
	Ext         string
	ContentType string
	Filename    string
	SavedPath   string
	Warning     string
}

func DownloadSongData(song *model.Song, withCover bool, withLyrics bool) (*DownloadedSong, error) {
	if song == nil {
		return nil, errors.New("song is nil")
	}
	if strings.TrimSpace(song.ID) == "" || strings.TrimSpace(song.Source) == "" {
		return nil, errors.New("missing song id or source")
	}

	normalized := *song
	normalized.Name = strings.TrimSpace(normalized.Name)
	normalized.Artist = strings.TrimSpace(normalized.Artist)
	if normalized.Name == "" {
		normalized.Name = "Unknown"
	}
	if normalized.Artist == "" {
		normalized.Artist = "Unknown"
	}

	audioData, contentType, err := fetchSongAudio(&normalized)
	if err != nil {
		return nil, err
	}

	ext := DetectAudioExt(audioData)
	if extByType := DetectAudioExtByContentType(contentType); extByType != "" {
		ext = extByType
	}

	var lyric string
	if withLyrics {
		if lyricFn := GetLyricFunc(normalized.Source); lyricFn != nil {
			lyric, _ = lyricFn(&model.Song{ID: normalized.ID, Source: normalized.Source, Extra: normalized.Extra})
		}
	}

	var coverData []byte
	var coverMime string
	if withCover && strings.TrimSpace(normalized.Cover) != "" {
		coverData, coverMime, _ = FetchBytesWithMime(normalized.Cover, normalized.Source)
	}

	finalData := audioData
	warning := ""
	if (ext == "mp3" || ext == "flac" || ext == "m4a" || ext == "wma") && (lyric != "" || len(coverData) > 0) {
		embeddedData, embedErr := EmbedSongMetadata(audioData, &normalized, lyric, coverData, coverMime)
		switch {
		case embedErr == nil:
			finalData = embeddedData
		case errors.Is(embedErr, ErrFFmpegNotFound):
			warning = "ffmpeg not found, metadata embedding skipped"
		default:
			warning = "metadata embedding failed, using original audio"
		}
	}

	if ext == "" {
		ext = DetectAudioExt(finalData)
	}

	return &DownloadedSong{
		Data:        finalData,
		Ext:         ext,
		ContentType: AudioMimeByExt(ext),
		Filename:    fmt.Sprintf("%s - %s.%s", normalized.Name, normalized.Artist, ext),
		Warning:     warning,
	}, nil
}

func SaveSongToFile(song *model.Song, outDir string, withCover bool, withLyrics bool) (*DownloadedSong, error) {
	result, err := DownloadSongData(song, withCover, withLyrics)
	if err != nil {
		return nil, err
	}

	targetDir := strings.TrimSpace(outDir)
	if targetDir == "" {
		targetDir = DefaultWebDownloadDir
	}
	targetDir = filepath.Clean(targetDir)

	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return nil, err
	}

	name := "Unknown"
	artist := "Unknown"
	if song != nil && strings.TrimSpace(song.Name) != "" {
		name = strings.TrimSpace(song.Name)
	}
	if song != nil && strings.TrimSpace(song.Artist) != "" {
		artist = strings.TrimSpace(song.Artist)
	}

	fileName := fmt.Sprintf("%s - %s.%s", utils.SanitizeFilename(name), utils.SanitizeFilename(artist), result.Ext)
	filePath := filepath.Join(targetDir, fileName)
	if err := os.WriteFile(filePath, result.Data, 0644); err != nil {
		return nil, err
	}

	result.SavedPath = filePath
	return result, nil
}

func fetchSongAudio(song *model.Song) ([]byte, string, error) {
	if song.Source == "soda" {
		cookie := CM.Get("soda")
		sodaInst := soda.New(cookie)
		info, err := sodaInst.GetDownloadInfo(song)
		if err != nil {
			return nil, "", err
		}

		encryptedData, _, err := FetchBytesWithMime(info.URL, "soda")
		if err != nil {
			return nil, "", err
		}

		finalData, err := soda.DecryptAudio(encryptedData, info.PlayAuth)
		if err != nil {
			return nil, "", err
		}
		return finalData, "", nil
	}

	dlFunc := GetDownloadFunc(song.Source)
	if dlFunc == nil {
		return nil, "", fmt.Errorf("unsupported source: %s", song.Source)
	}

	urlStr, err := dlFunc(song)
	if err != nil {
		return nil, "", err
	}
	urlStr = strings.TrimSpace(urlStr)
	if urlStr == "" || urlStr == "None" || urlStr == "null" || urlStr == "undefined" {
		return nil, "", errors.New("该歌曲暂无可用下载链接")
	}

	return FetchBytesWithMime(urlStr, song.Source)
}
