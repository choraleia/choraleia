package handler

import (
	"net/http"
	"path/filepath"
	"strings"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/service"
	fsimpl "github.com/choraleia/choraleia/pkg/service/fs"
	"github.com/gin-gonic/gin"
)

type FSHandler struct {
	svc *service.FSService
}

func NewFSHandler(svc *service.FSService) *FSHandler {
	return &FSHandler{svc: svc}
}

// parseEndpointSpec extracts endpoint parameters from query.
// Endpoint type will be auto-detected from asset_id by FSRegistry.
func parseEndpointSpec(c *gin.Context) service.EndpointSpec {
	return service.EndpointSpec{
		AssetID:     strings.TrimSpace(c.Query("asset_id")),
		ContainerID: strings.TrimSpace(c.Query("container_id")),
	}
}

func (h *FSHandler) List(c *gin.Context) {
	spec := parseEndpointSpec(c)
	p := c.Query("path")
	includeHidden := strings.EqualFold(c.Query("include_hidden"), "true")

	resp, err := h.svc.ListDir(c.Request.Context(), spec, p, fsimpl.ListDirOptions{IncludeHidden: includeHidden})
	if err != nil {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.Response{Code: 0, Message: "ok", Data: resp})
}

func (h *FSHandler) Stat(c *gin.Context) {
	spec := parseEndpointSpec(c)
	p := c.Query("path")
	if strings.TrimSpace(p) == "" {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "path is required"})
		return
	}

	entry, err := h.svc.Stat(c.Request.Context(), spec, p)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.Response{Code: 0, Message: "ok", Data: entry})
}

func (h *FSHandler) Download(c *gin.Context) {
	spec := parseEndpointSpec(c)
	p := c.Query("path")
	if strings.TrimSpace(p) == "" {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "path is required"})
		return
	}

	c.Header("Content-Type", "application/octet-stream")
	filename, err := h.svc.Download(c.Request.Context(), spec, p, c.Writer)
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	c.Header("Content-Disposition", "attachment; filename=\""+sanitizeFilename(filename)+"\"")
}

func (h *FSHandler) Upload(c *gin.Context) {
	spec := parseEndpointSpec(c)
	p := c.Query("path")
	overwrite := strings.EqualFold(c.Query("overwrite"), "true")
	if strings.TrimSpace(p) == "" {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "path is required"})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "missing multipart field 'file'"})
		return
	}
	defer func() { _ = file.Close() }()

	// If the provided path is a directory, append the uploaded filename.
	if strings.HasSuffix(p, "/") || filepath.Base(p) == "." {
		p = p + header.Filename
	}

	if err := h.svc.Upload(c.Request.Context(), spec, p, file, overwrite); err != nil {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.Response{Code: 0, Message: "ok"})
}

func (h *FSHandler) Mkdir(c *gin.Context) {
	spec := parseEndpointSpec(c)
	p := c.Query("path")
	if strings.TrimSpace(p) == "" {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "path is required"})
		return
	}
	if err := h.svc.Mkdir(c.Request.Context(), spec, p); err != nil {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.Response{Code: 0, Message: "ok"})
}

func (h *FSHandler) Remove(c *gin.Context) {
	spec := parseEndpointSpec(c)
	p := c.Query("path")
	if strings.TrimSpace(p) == "" {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "path is required"})
		return
	}
	if err := h.svc.Remove(c.Request.Context(), spec, p); err != nil {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.Response{Code: 0, Message: "ok"})
}

func (h *FSHandler) Rename(c *gin.Context) {
	spec := parseEndpointSpec(c)
	from := c.Query("from")
	to := c.Query("to")
	if strings.TrimSpace(from) == "" || strings.TrimSpace(to) == "" {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "from and to are required"})
		return
	}
	if err := h.svc.Rename(c.Request.Context(), spec, from, to); err != nil {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.Response{Code: 0, Message: "ok"})
}

func (h *FSHandler) Pwd(c *gin.Context) {
	spec := parseEndpointSpec(c)

	pwd, err := h.svc.Pwd(c.Request.Context(), spec)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.Response{Code: 0, Message: "ok", Data: gin.H{"path": pwd}})
}

func sanitizeFilename(name string) string {
	name = filepath.Base(name)
	name = strings.ReplaceAll(name, "\"", "")
	name = strings.ReplaceAll(name, "\\", "_")
	if name == "" {
		return "download"
	}
	return name
}
