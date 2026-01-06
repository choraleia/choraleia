package event

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// WSMessage is the JSON message sent over WebSocket.
type WSMessage struct {
	Event string         `json:"event"`          // Event name (e.g., "fs.changed")
	Data  map[string]any `json:"data,omitempty"` // Event-specific data
	TS    int64          `json:"ts"`             // Timestamp (Unix ms)
}

// WSHandler handles WebSocket connections for event notifications.
type WSHandler struct {
	emitter  *Emitter
	upgrader websocket.Upgrader
}

// NewWSHandler creates a WebSocket handler using the global emitter.
func NewWSHandler() *WSHandler {
	return &WSHandler{
		emitter: Global(),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

// Handle is the Gin handler for WebSocket connections.
// Query params:
//   - events: comma-separated event names to subscribe (empty = all)
//
// Example: /api/events/ws?events=fs.changed,asset.created,asset.deleted
func (h *WSHandler) Handle(c *gin.Context) {
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// Parse event filter
	var eventFilter map[string]bool
	if eventsParam := c.Query("events"); eventsParam != "" {
		eventFilter = make(map[string]bool)
		for _, e := range strings.Split(eventsParam, ",") {
			if e = strings.TrimSpace(e); e != "" {
				eventFilter[e] = true
			}
		}
	}

	// Channel for sending events to this client
	sendCh := make(chan WSMessage, 64)
	done := make(chan struct{})

	// Subscribe to events
	unsubscribe := h.emitter.OnAny(func(ev Event) {
		// Filter events if specified
		if eventFilter != nil && !eventFilter[ev.EventName()] {
			return
		}

		msg := WSMessage{
			Event: ev.EventName(),
			Data:  eventToData(ev),
			TS:    time.Now().UnixMilli(),
		}

		select {
		case sendCh <- msg:
			log.Printf("[WS] Queued event %s", ev.EventName())
		default:
			// Drop if buffer is full
			log.Printf("[WS] Dropped event %s (buffer full)", ev.EventName())
		}
	})
	defer unsubscribe()

	// Reader goroutine - keeps connection alive
	go func() {
		defer close(done)
		conn.SetReadLimit(4096)
		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		conn.SetPongHandler(func(string) error {
			_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
			return nil
		})
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	var writeMu sync.Mutex

	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-done:
			return
		case <-ticker.C:
			writeMu.Lock()
			_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			err := conn.WriteMessage(websocket.PingMessage, nil)
			writeMu.Unlock()
			if err != nil {
				return
			}
		case msg := <-sendCh:
			writeMu.Lock()
			_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			err := conn.WriteJSON(msg)
			writeMu.Unlock()
			if err != nil {
				return
			}
		}
	}
}

// eventToData converts an Event to a map for JSON serialization.
func eventToData(ev Event) map[string]any {
	// Use JSON marshal/unmarshal for simplicity
	data, err := json.Marshal(ev)
	if err != nil {
		return nil
	}
	var result map[string]any
	if err := json.Unmarshal(data, &result); err != nil {
		return nil
	}
	return result
}
