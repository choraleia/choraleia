//go:build headless

package main

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"io/fs"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// Embed built frontend distribution
//
//go:embed all:frontend/dist
var headlessAssets embed.FS

// attachStatic registers static asset middleware:
// 1. Only enabled when OMNITERM_DISABLE_STATIC!=1
// 2. Intercepts GET/HEAD requests not under /api or /terminal
// 3. If a static file matches, serve it directly and Abort
// 4. If no match and path has no '.' and Accept includes text/html, treat as SPA and serve index.html
// 5. Otherwise pass through
func attachStatic(engine *gin.Engine) {
	if os.Getenv("OMNITERM_DISABLE_STATIC") == "1" {
		return
	}

	distFS, err := fs.Sub(headlessAssets, "frontend/dist")
	if err != nil {
		return
	}

	var (
		indexOnce    sync.Once
		indexBytes   []byte
		indexErr     error
		indexETag    string
		indexModTime time.Time
	)
	loadIndex := func() {
		indexBytes, indexErr = fs.ReadFile(distFS, "index.html")
		if indexErr == nil {
			if fi, statErr := fs.Stat(distFS, "index.html"); statErr == nil {
				indexModTime = fi.ModTime()
			} else {
				indexModTime = time.Now()
			}
			h := sha256.Sum256(indexBytes)
			indexETag = `W/"` + strings.ToLower(hexEncode(h[:8])) + `"`
		}
	}

	fileServer := http.FileServer(http.FS(distFS))

	engine.Use(func(c *gin.Context) {
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			return
		}
		p := c.Request.URL.Path
		if strings.HasPrefix(p, "/api") || strings.HasPrefix(p, "/terminal") || p == "/healthz" {
			return
		}
		if p == "/" {
			serveIndex(c, &indexOnce, loadIndex, &indexErr, indexModTime, indexETag, indexBytes)
			return
		}
		trimmed := strings.TrimPrefix(p, "/")
		if trimmed == "" {
			return
		}
		if f, err := distFS.Open(trimmed); err == nil {
			_ = f.Close()
			if fi, serr := fs.Stat(distFS, trimmed); serr == nil && fi.IsDir() {
				serveIndex(c, &indexOnce, loadIndex, &indexErr, indexModTime, indexETag, indexBytes)
				return
			}
			fileServer.ServeHTTP(c.Writer, c.Request)
			c.Abort()
			return
		}

		// SPA fallback: serve index.html for client-side routes.
		// Some clients omit the Accept header on the initial navigation, so treat empty Accept as HTML.
		if !strings.Contains(trimmed, ".") && acceptHTML(c.Request.Header.Get("Accept")) {
			serveIndex(c, &indexOnce, loadIndex, &indexErr, indexModTime, indexETag, indexBytes)
			return
		}
	})
}

func serveIndex(c *gin.Context, once *sync.Once, loader func(), errPtr *error, modTime time.Time, etag string, data []byte) {
	once.Do(loader)
	if *errPtr != nil || len(data) == 0 {
		return
	}
	if etag != "" {
		if c.Request.Header.Get("If-None-Match") == etag {
			c.Status(http.StatusNotModified)
			c.Abort()
			return
		}
		c.Header("ETag", etag)
	}
	c.Header("Cache-Control", "no-cache")
	c.Header("Content-Type", "text/html; charset=utf-8")
	http.ServeContent(c.Writer, c.Request, "index.html", modTime, bytes.NewReader(data))
	c.Abort()
}

func acceptHTML(accept string) bool {
	// Treat missing Accept as HTML navigation (common in some embedded/webview cases).
	if accept == "" {
		return true
	}
	for _, part := range strings.Split(accept, ",") {
		p := strings.TrimSpace(strings.ToLower(part))
		if strings.HasPrefix(p, "text/html") || strings.HasPrefix(p, "application/xhtml+xml") {
			return true
		}
	}
	return false
}

// hexEncode returns a short lowercase hex string (weak ETag helper)
func hexEncode(b []byte) string {
	const hexdigits = "0123456789abcdef"
	var out strings.Builder
	for _, x := range b {
		out.WriteByte(hexdigits[x>>4])
		out.WriteByte(hexdigits[x&0x0f])
	}
	return out.String()
}
