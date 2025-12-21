package main

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// Embed built frontend distribution.
//
//go:embed all:frontend/dist
var staticAssets embed.FS

// attachStatic registers embedded static asset middleware:
//  1. Intercepts GET/HEAD requests not under /api or /terminal
//  2. If a static file matches, serve it directly and Abort
//  3. If no match and path has no '.' and Accept includes text/html, treat as SPA and serve index.html
//  4. otherwise pass through
func attachStatic(engine *gin.Engine, _ func() int) {
	distFS := resolveFrontendFS()
	if distFS == nil {
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
		// Let API + websocket routes fall through.
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
		if !strings.Contains(trimmed, ".") && acceptHTML(c.Request.Header.Get("Accept")) {
			serveIndex(c, &indexOnce, loadIndex, &indexErr, indexModTime, indexETag, indexBytes)
			return
		}
	})
}

// serveIndexFallback attempts to serve the SPA index.html if the request looks like a browser navigation.
// It is safe to call from NoRoute.
func serveIndexFallback(c *gin.Context, _ func() int) {
	if c == nil || c.Request == nil {
		return
	}
	if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
		return
	}
	p := c.Request.URL.Path
	if strings.HasPrefix(p, "/api") || strings.HasPrefix(p, "/terminal") || strings.HasPrefix(p, "/wails") {
		return
	}
	trimmed := strings.TrimPrefix(p, "/")
	if trimmed != "" && strings.Contains(trimmed, ".") {
		return
	}
	if !acceptHTML(c.Request.Header.Get("Accept")) {
		return
	}

	distFS := resolveFrontendFS()
	if distFS == nil {
		return
	}

	b, err := fs.ReadFile(distFS, "index.html")
	if err != nil || len(b) == 0 {
		return
	}

	modTime := time.Now()
	if fi, statErr := fs.Stat(distFS, "index.html"); statErr == nil {
		modTime = fi.ModTime()
	}

	c.Header("Cache-Control", "no-cache")
	c.Header("Content-Type", "text/html; charset=utf-8")
	http.ServeContent(c.Writer, c.Request, "index.html", modTime, bytes.NewReader(b))
	c.Abort()
}

func resolveFrontendFS() fs.FS {
	// Preferred: embedded dist.
	if sub, err := fs.Sub(staticAssets, "frontend/dist"); err == nil {
		// Ensure index exists so later logic doesn't keep returning silently.
		if _, err := fs.Stat(sub, "index.html"); err == nil {
			return sub
		}
	}

	// Dev fallback: disk dist (useful when running `go run` without embedding built assets).
	wd, err := os.Getwd()
	if err != nil {
		return nil
	}
	candidates := []string{
		filepath.Join(wd, "frontend", "dist"),
		filepath.Join(wd, "frontend"),
	}
	for _, dir := range candidates {
		if st, err := os.Stat(dir); err == nil && st.IsDir() {
			dfs := os.DirFS(dir)
			if _, err := fs.Stat(dfs, "index.html"); err == nil {
				return dfs
			}
		}
	}
	return nil
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

// acceptHTML determines if the given accept header string indicates
// that the client accepts HTML content.
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
