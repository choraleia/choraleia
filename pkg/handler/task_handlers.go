package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/service"
	"github.com/choraleia/choraleia/pkg/utils"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

type TaskHandler struct {
	tasks     *service.TaskService
	transfers *service.TransferTaskService
}

func NewTaskHandler(tasks *service.TaskService, transfers *service.TransferTaskService) *TaskHandler {
	return &TaskHandler{tasks: tasks, transfers: transfers}
}

func (h *TaskHandler) ListActive(c *gin.Context) {
	c.JSON(http.StatusOK, models.Response{Code: 0, Message: "ok", Data: h.tasks.ListRunning()})
}

func (h *TaskHandler) ListHistory(c *gin.Context) {
	limit := 50
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	c.JSON(http.StatusOK, models.Response{Code: 0, Message: "ok", Data: h.tasks.ListHistory(limit)})
}

func (h *TaskHandler) Cancel(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "id is required"})
		return
	}
	if err := h.tasks.Cancel(id); err != nil {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.Response{Code: 0, Message: "ok"})
}

func (h *TaskHandler) EnqueueTransfer(c *gin.Context) {
	var req service.TransferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
		return
	}

	// minimal validation - paths and destination are required
	if len(req.From.Paths) == 0 || req.To.Path == "" {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "from.paths and to.path are required"})
		return
	}

	task := h.transfers.EnqueueCopy(req)
	c.JSON(http.StatusOK, models.Response{Code: 0, Message: "ok", Data: task})
}

// EventsWS provides task events over WebSocket.
//
// This avoids proxy issues in some dev environments.
//
// Kubernetes-style list-watch semantics:
// - The server sends a full snapshot after connection: {type:"SNAPSHOT", data:{resourceVersion, active, history}}
// - The server streams incremental events: {type:"EVENT", data:{type, resourceVersion, task}}
// - The server periodically sends a resync snapshot over the same socket.
//
// Query params:
// - since: resume from a known resourceVersion (best-effort; server may fall back to snapshot)
// - history_limit: max history items in snapshot/resync
// - resync: resync interval seconds (default 30)
func (h *TaskHandler) EventsWS(c *gin.Context) {
	logger := utils.GetLogger()
	req := c.Request
	logger.Info("Task WS connection request",
		"method", req.Method,
		"path", req.URL.Path,
		"host", req.Host,
		"origin", req.Header.Get("Origin"),
		"userAgent", req.Header.Get("User-Agent"),
	)

	upgrader := &websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			// Allow common dev/prod origins; be permissive by default.
			return true
		},
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		logger.Error("Task WS upgrade failed", "error", err)
		return
	}
	logger.Info("Task WS connection established")
	defer func() { _ = conn.Close() }()

	// Parse query params.
	sinceRV := uint64(0)
	if v := c.Query("since"); v != "" {
		if n, err := strconv.ParseUint(v, 10, 64); err == nil {
			sinceRV = n
		}
	}

	historyLimit := 100
	if v := c.Query("history_limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			historyLimit = n
		}
	}

	resyncSeconds := 30
	if v := c.Query("resync"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			resyncSeconds = n
		}
	}
	if resyncSeconds < 10 {
		resyncSeconds = 10
	}

	// Subscribe to watch events (best-effort resume).
	watchCh, watchCancel, _, resumeOK := h.tasks.SubscribeWatch(sinceRV)
	defer watchCancel()

	// Always send a snapshot first. This makes the client implementation simple and robust.
	// If future optimization is desired, resumeOK+sinceRV can be used to send only replayed events.
	snapshot := h.tasks.ListSnapshot(historyLimit)
	_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	if err := conn.WriteJSON(gin.H{
		"type":   "SNAPSHOT",
		"data":   snapshot,
		"resume": gin.H{"since": sinceRV, "ok": resumeOK},
	}); err != nil {
		logger.Info("Task WS initial snapshot write failed", "error", err)
		return
	}

	// If resume succeeded and we already replayed buffered events into watchCh, keep going.
	// If it didn't, the snapshot contains the latest state anyway.
	_ = resumeOK

	// Keep the connection alive.
	conn.SetReadLimit(32 * 1024)
	_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	// Reader goroutine just drains control frames.
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			// We don't expect client messages; just read to process pings/pongs.
			if _, _, err := conn.ReadMessage(); err != nil {
				logger.Info("Task WS read loop exit", "error", err)
				return
			}
		}
	}()

	pingTicker := time.NewTicker(20 * time.Second)
	defer pingTicker.Stop()

	resyncTicker := time.NewTicker(time.Duration(resyncSeconds) * time.Second)
	defer resyncTicker.Stop()

	bookmarkTicker := time.NewTicker(10 * time.Second)
	defer bookmarkTicker.Stop()

	for {
		select {
		case <-c.Request.Context().Done():
			logger.Info("Task WS context done")
			return
		case <-done:
			return
		case <-pingTicker.C:
			_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				logger.Info("Task WS ping failed", "error", err)
				return
			}
		case <-bookmarkTicker.C:
			// Lightweight heartbeat: send just the latest resourceVersion.
			// This helps clients resume quickly after transient disconnects.
			rv := h.tasks.ResourceVersion()
			_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteJSON(gin.H{"type": "BOOKMARK", "data": gin.H{"resourceVersion": rv}}); err != nil {
				logger.Info("Task WS bookmark write failed", "error", err)
				return
			}
		case <-resyncTicker.C:
			// Periodic resync snapshot.
			snap := h.tasks.ListSnapshot(historyLimit)
			_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteJSON(gin.H{"type": "SNAPSHOT", "data": snap, "resync": true}); err != nil {
				logger.Info("Task WS resync snapshot write failed", "error", err)
				return
			}
		case ev, ok := <-watchCh:
			if !ok {
				return
			}
			_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteJSON(gin.H{"type": "EVENT", "data": ev}); err != nil {
				logger.Info("Task WS event write failed", "error", err)
				return
			}
		}
	}
}
