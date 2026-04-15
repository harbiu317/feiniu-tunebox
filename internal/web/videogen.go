package web

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/guohuiyuan/go-music-dl/core"
	"github.com/guohuiyuan/music-lib/model"
)

type RenderSession struct {
	ID        string
	Dir       string
	AudioPath string
	Total     int
	Mutex     sync.Mutex
}

var (
	sessions = make(map[string]*RenderSession)
	sessMu   sync.Mutex
)

func CleanupOldFiles(dir string, maxAge time.Duration) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	now := time.Now()
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if now.Sub(info.ModTime()) > maxAge {
			os.Remove(filepath.Join(dir, entry.Name()))
		}
	}
}

func saveBase64(dataURI, path string) error {
	if len(dataURI) > 23 {
		dataURI = dataURI[23:]
	}
	data, err := base64.StdEncoding.DecodeString(dataURI)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

func RegisterVideogenRoutes(api *gin.RouterGroup, videoDir string) {
	go func() {
		for {
			time.Sleep(10 * time.Minute)
			CleanupOldFiles(videoDir, 10*time.Minute)
		}
	}()

	videoApi := api.Group("/videogen")
	videoApi.POST("/init", func(c *gin.Context) {
		var id, source string
		var hasCustomAudio bool

		if strings.HasPrefix(c.GetHeader("Content-Type"), "multipart/form-data") {
			id = c.PostForm("id")
			source = c.PostForm("source")
			hasCustomAudio = true
		} else {
			var req struct {
				ID     string `json:"id"`
				Source string `json:"source"`
			}
			if c.ShouldBindJSON(&req) != nil {
				c.JSON(400, gin.H{"error": "Args error"})
				return
			}
			id = req.ID
			source = req.Source
		}

		sessionID := fmt.Sprintf("%s_%s_%d", source, id, time.Now().Unix())
		tempDir, _ := os.MkdirTemp("", "vg_render_"+sessionID+"_*")
		audioPath := filepath.Join(tempDir, "audio.mp3")

		var proxyAudioUrl string

		if hasCustomAudio {
			file, err := c.FormFile("audio_file")
			if err != nil {
				c.JSON(400, gin.H{"error": "Failed to receive custom audio"})
				return
			}
			if err := c.SaveUploadedFile(file, audioPath); err != nil {
				c.JSON(500, gin.H{"error": "Failed to save custom audio"})
				return
			}
			proxyAudioUrl = ""
		} else {
			fn := core.GetDownloadFunc(source)
			if fn == nil {
				c.JSON(500, gin.H{"error": "Source not supported"})
				return
			}
			audioUrl, err := fn(&model.Song{ID: id, Source: source})
			if err != nil {
				c.JSON(500, gin.H{"error": "Audio download failed"})
				return
			}

			reqHttp, _ := core.BuildSourceRequest("GET", audioUrl, source, "")
			client := &http.Client{}
			resp, err := client.Do(reqHttp)
			if err != nil {
				c.JSON(500, gin.H{"error": "Save audio failed"})
				return
			}
			defer resp.Body.Close()
			out, _ := os.Create(audioPath)
			io.Copy(out, resp.Body)
			out.Close()

			proxyAudioUrl = fmt.Sprintf("%s/download?id=%s&source=%s", RoutePrefix, url.QueryEscape(id), source)
		}

		sess := &RenderSession{
			ID:        sessionID,
			Dir:       tempDir,
			AudioPath: audioPath,
		}

		sessMu.Lock()
		sessions[sessionID] = sess
		sessMu.Unlock()

		c.JSON(200, gin.H{"session_id": sessionID, "audio_url": proxyAudioUrl})
	})

	videoApi.POST("/frame", func(c *gin.Context) {
		var req struct {
			SessionID string   `json:"session_id"`
			Frames    []string `json:"frames"`
			StartIdx  int      `json:"start_idx"`
		}
		if c.ShouldBindJSON(&req) != nil {
			c.JSON(400, gin.H{"error": "Bad request"})
			return
		}

		sessMu.Lock()
		sess, ok := sessions[req.SessionID]
		sessMu.Unlock()
		if !ok {
			c.JSON(404, gin.H{"error": "Session not found"})
			return
		}

		sess.Mutex.Lock()
		defer sess.Mutex.Unlock()

		for i, dataURI := range req.Frames {
			frameNum := req.StartIdx + i
			fileName := filepath.Join(sess.Dir, fmt.Sprintf("frame_%05d.jpg", frameNum))
			saveBase64(dataURI, fileName)
		}
		sess.Total += len(req.Frames)

		c.JSON(200, gin.H{"status": "ok", "received": len(req.Frames)})
	})

	videoApi.POST("/finish", func(c *gin.Context) {
		var req struct {
			SessionID string `json:"session_id"`
			Name      string `json:"name"`
		}
		c.ShouldBindJSON(&req)

		sessMu.Lock()
		sess, ok := sessions[req.SessionID]
		delete(sessions, req.SessionID)
		sessMu.Unlock()

		if !ok {
			c.JSON(404, gin.H{"error": "Session not found"})
			return
		}

		absVideoDir, _ := filepath.Abs(videoDir)
		outName := fmt.Sprintf("render_%s_%d.mp4", sess.ID, time.Now().Unix())
		outPath := filepath.Join(absVideoDir, outName)

		cmd := exec.Command("ffmpeg",
			"-y",
			"-framerate", "30",
			"-i", filepath.Join(sess.Dir, "frame_%05d.jpg"),
			"-i", sess.AudioPath,
			"-c:v", "libx264",
			"-preset", "ultrafast",
			"-c:a", "aac",
			"-b:a", "320k",
			"-pix_fmt", "yuv420p",
			"-shortest",
			outPath,
		)

		output, err := cmd.CombinedOutput()
		os.RemoveAll(sess.Dir)

		if err != nil {
			fmt.Println("FFmpeg Error:", string(output))
			c.JSON(500, gin.H{"error": "Render failed: " + err.Error()})
			return
		}

		c.JSON(200, gin.H{"url": "/videos/" + outName})
	})
}