package service

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/choraleia/choraleia/pkg/message"
	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/utils"
	"github.com/gin-gonic/gin"

	"github.com/aymanbagabas/go-pty"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

// ConnectionType defines connection type
type ConnectionType string

const (
	ConnectionTypeLocal ConnectionType = "local"
	ConnectionTypeSSH   ConnectionType = "ssh"
)

type TerminalService struct {
	assetService *AssetService
	logger       *slog.Logger
}

// Terminal struct
type Terminal struct {
	ctx          context.Context
	conn         *websocket.Conn
	assetService *AssetService
	assetID      string
	sessionID    string // session ID field
	logger       *slog.Logger
	paused       bool

	// Local terminal related
	localCmd *pty.Cmd
	localTty pty.Pty

	// SSH connection related
	sshClient  *ssh.Client
	sshSession *ssh.Session
	sshStdin   io.WriteCloser
	sshStdout  io.Reader
	sshStderr  io.Reader

	connType   ConnectionType
	rows       int
	cols       int
	exitChan   chan struct{}
	readyChan  chan struct{}
	readyOnce  sync.Once
	writeMutex sync.Mutex
}

// WebSocketMessage format
type WebSocketMessage struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

//go:embed themes
var themes embed.FS

type Theme struct {
	Foreground          string `json:"cursor"`
	Background          string `json:"selectionBackground"`
	Black               string `json:"brightYellow"`
	Blue                string `json:"brightWhite"`
	Cyan                string `json:"brightRed"`
	Green               string `json:"brightMagenta"`
	Magenta             string `json:"brightGreen"`
	Red                 string `json:"brightCyan"`
	White               string `json:"brightBlue"`
	Yellow              string `json:"brightBlack"`
	BrightBlack         string `json:"yellow"`
	BrightBlue          string `json:"white"`
	BrightCyan          string `json:"red"`
	BrightGreen         string `json:"magenta"`
	BrightMagenta       string `json:"green"`
	BrightRed           string `json:"cyan"`
	BrightWhite         string `json:"blue"`
	BrightYellow        string `json:"black"`
	SelectionBackground string `json:"background"`
	Cursor              string `json:"foreground"`
}

func loadTheme(name string) (*Theme, error) {
	f, err := themes.Open(path.Join("themes", fmt.Sprintf("%s.json", name)))
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()

	var theme Theme
	if err := json.NewDecoder(f).Decode(&theme); err != nil {
		return nil, err
	}
	return &theme, nil
}

func NewTerminalService(assetService *AssetService) *TerminalService {
	return &TerminalService{
		assetService: assetService,
		logger:       utils.GetLogger(),
	}
}

func (s *TerminalService) RunTerminal(c *gin.Context) {
	assetID := c.Param("assetId")
	if assetID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Asset ID is required"})
		return
	}

	req := c.Request
	s.logger.Info("WebSocket connection request",
		"assetId", assetID,
		"method", req.Method,
		"path", req.URL.Path,
		"host", req.Host,
		"origin", req.Header.Get("Origin"),
		"userAgent", req.Header.Get("User-Agent"),
	)

	// Configure WebSocket upgrade options
	upgrader := &websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
		// Add error handling
		Error: func(w http.ResponseWriter, r *http.Request, status int, reason error) {
			s.logger.Error("WebSocket upgrade error",
				"status", status,
				"reason", reason,
				"assetId", assetID,
				"host", r.Host,
				"origin", r.Header.Get("Origin"),
				"userAgent", r.Header.Get("User-Agent"),
			)
			http.Error(w, reason.Error(), status)
		},
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		s.logger.Error("WebSocket upgrade failed", "error", err, "assetId", assetID)
		return
	}
	defer func() {
		if err := conn.Close(); err != nil {
			s.logger.Error("Failed to close websocket connection", "error", err, "assetId", assetID)
		}
	}()

	s.logger.Info("WebSocket connection established", "assetId", assetID)

	// Configure connection parameters
	conn.SetReadLimit(32768)
	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	conn.SetPingHandler(func(string) error {
		_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		_ = conn.WriteMessage(websocket.PongMessage, nil)
		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	// Send initial connection status
	if err := conn.WriteJSON(map[string]interface{}{
		"type": "status",
		"data": map[string]string{
			"status":  "connecting",
			"message": "Establishing connection...",
		},
	}); err != nil {
		s.logger.Error("Failed to send initial status", "error", err, "assetId", assetID)
		return
	}

	// Create new terminal instance with asset ID
	term := NewTerminal(c.Request.Context(), conn, s.assetService, assetID)

	// Start connection based on asset type
	if err := term.Start(); err != nil {
		s.logger.Error("Failed to start terminal", "error", err, "assetId", assetID)
		if err := conn.WriteJSON(map[string]interface{}{
			"type": "status",
			"data": map[string]string{
				"status":  "error",
				"message": fmt.Sprintf("Failed to start terminal: %v", err),
			},
		}); err != nil {
			s.logger.Error("Failed to write error message to websocket", "error", err, "assetId", assetID)
		}
		return
	}

	// Wait for terminal initialization
	if err := term.WaitForReady(); err != nil {
		s.logger.Error("Terminal not ready", "error", err, "assetId", assetID)
		if err := conn.WriteJSON(map[string]interface{}{
			"type": "status",
			"data": map[string]string{
				"status":  "error",
				"message": "Terminal initialization failed",
			},
		}); err != nil {
			s.logger.Error("Failed to write error message to websocket", "error", err, "assetId", assetID)
		}
		return
	}

	// Send connection success status
	if err := conn.WriteJSON(map[string]interface{}{
		"type": "status",
		"data": map[string]string{
			"status":  "connected",
			"message": "Terminal connection established",
		},
	}); err != nil {
		s.logger.Error("Failed to send connection success status", "error", err, "assetId", assetID)
	}

	// Attach backend terminal instance to session (temporary sessionID)
	GlobalTerminalManager.AttachTerminal(term.sessionID, term)

	// Send theme configuration
	theme, err := loadTheme("tomorrow-night")
	if err != nil {
		s.logger.Warn("Failed to load theme", "error", err, "theme", "tomorrow-night")
	} else {
		if err := conn.WriteJSON(map[string]interface{}{"type": "change-theme", "themeOptions": theme}); err != nil {
			s.logger.Error("Failed to send theme to websocket", "error", err, "assetId", assetID)
		}
	}

	// Run terminal
	term.Run()
}

// NewTerminal creates a new terminal instance
func NewTerminal(ctx context.Context, conn *websocket.Conn, assetService *AssetService, assetID string) *Terminal {
	// Generate temporary session ID; replaced later by frontend tab
	tempSessionID := fmt.Sprintf("temp_%s_%d", assetID, time.Now().UnixNano())

	terminal := &Terminal{
		ctx:          ctx,
		conn:         conn,
		assetService: assetService,
		assetID:      assetID,
		logger:       utils.GetLogger(),
		exitChan:     make(chan struct{}),
		readyChan:    make(chan struct{}),
		rows:         24,
		cols:         80,
		paused:       false,
		sessionID:    tempSessionID, // set temporary session ID
	}

	// Store session ID in terminal instance
	terminal.logger = terminal.logger.With("sessionID", tempSessionID)

	return terminal
}

// Start starts appropriate connection by asset type
func (t *Terminal) Start() error {
	// Retrieve asset info
	asset, err := t.assetService.GetAsset(t.assetID)
	if err != nil {
		return fmt.Errorf("failed to get asset: %w", err)
	}

	// Start different connection according to asset type
	switch asset.Type {
	case models.AssetTypeLocal:
		t.connType = ConnectionTypeLocal
		return t.startLocalShell(asset)
	case models.AssetTypeSSH:
		t.connType = ConnectionTypeSSH
		return t.startSSHConnection(asset)
	default:
		return fmt.Errorf("unsupported asset type: %s", asset.Type)
	}
}

// startLocalShell starts local shell
func (t *Terminal) startLocalShell(asset *models.Asset) error {
	tty, err := pty.New()
	if err != nil {
		return fmt.Errorf("failed to create pty: %w", err)
	}
	t.localTty = tty

	// Load configuration
	config := asset.Config
	shell := "/bin/bash"
	workingDir := ""

	if shellConfig, ok := config["shell"].(string); ok && shellConfig != "" {
		shell = shellConfig
	}
	if dirConfig, ok := config["working_dir"].(string); ok && dirConfig != "" {
		workingDir = dirConfig
	}

	// Create command
	cmd := tty.Command(shell)

	// Set environment variables
	env := os.Environ()
	env = append(env, "TERM=xterm-256color")
	if workingDir != "" {
		cmd.Dir = workingDir
	}
	cmd.Env = env

	if err := cmd.Start(); err != nil {
		if closeErr := t.localTty.Close(); closeErr != nil {
			t.logger.Error("Failed to close TTY after start error", "error", closeErr, "assetId", t.assetID)
		}
		return fmt.Errorf("failed to start shell: %w", err)
	}
	t.localCmd = cmd

	// Mark terminal ready
	t.readyOnce.Do(func() { close(t.readyChan) })
	return nil
}

// startSSHConnection starts SSH connection
func (t *Terminal) startSSHConnection(asset *models.Asset) error {
	config := asset.Config

	// Parse SSH config
	host, ok := config["host"].(string)
	if !ok || host == "" {
		return fmt.Errorf("SSH host not specified")
	}

	port := 22
	if portConfig, ok := config["port"].(float64); ok {
		port = int(portConfig)
	}

	username, ok := config["username"].(string)
	if !ok || username == "" {
		return fmt.Errorf("SSH username not specified")
	}

	// Build SSH client config
	sshConfig := &ssh.ClientConfig{
		User:            username,
		Auth:            []ssh.AuthMethod{},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // NOTE: production should verify host key
		Timeout:         30 * time.Second,
	}

	// Set timeout
	if timeoutConfig, ok := config["timeout"].(float64); ok {
		sshConfig.Timeout = time.Duration(timeoutConfig) * time.Second
	}

	// Add authentication methods
	if password, ok := config["password"].(string); ok && password != "" {
		sshConfig.Auth = append(sshConfig.Auth, ssh.Password(password))
	}

	passphrase, _ := config["private_key_passphrase"].(string) // optional passphrase for encrypted key

	if privateKeyPath, ok := config["private_key_path"].(string); ok && privateKeyPath != "" {
		if key, err := t.loadPrivateKey(privateKeyPath, passphrase); err == nil {
			sshConfig.Auth = append(sshConfig.Auth, ssh.PublicKeys(key))
		} else {
			// warn but continue to try other methods
			t.logger.Warn("Failed to load private key from file", "path", privateKeyPath, "error", err, "assetId", t.assetID)
		}
	}
	if privateKey, ok := config["private_key"].(string); ok && privateKey != "" {
		if key, err := t.parsePrivateKey(privateKey, passphrase); err == nil {
			sshConfig.Auth = append(sshConfig.Auth, ssh.PublicKeys(key))
		} else {
			t.logger.Warn("Failed to parse provided private key", "error", err, "assetId", t.assetID)
		}
	}

	// If no auth methods, try empty password
	if len(sshConfig.Auth) == 0 {
		sshConfig.Auth = append(sshConfig.Auth, ssh.Password(""))
	}

	// Establish SSH connection
	addr := fmt.Sprintf("%s:%d", host, port)
	client, err := ssh.Dial("tcp", addr, sshConfig)
	if err != nil {
		return fmt.Errorf("failed to connect to SSH server: %w", err)
	}
	t.sshClient = client

	// Create session
	session, err := client.NewSession()
	if err != nil {
		if closeErr := client.Close(); closeErr != nil {
			t.logger.Error("Failed to close SSH client after session creation error", "error", closeErr, "assetId", t.assetID)
		}
		return fmt.Errorf("failed to create SSH session: %w", err)
	}
	t.sshSession = session

	// Set terminal modes
	modes := ssh.TerminalModes{
		ssh.ECHO: 1,
		//ssh.TTY_OP_ISPEED: 14400,
		//ssh.TTY_OP_OSPEED: 14400,
	}

	if err := session.RequestPty("xterm-256color", t.rows, t.cols, modes); err != nil {
		if closeErr := session.Close(); closeErr != nil {
			t.logger.Error("Failed to close SSH session after PTY request error", "error", closeErr, "assetId", t.assetID)
		}
		if closeErr := client.Close(); closeErr != nil {
			t.logger.Error("Failed to close SSH client after PTY request error", "error", closeErr, "assetId", t.assetID)
		}
		return fmt.Errorf("failed to request pty: %w", err)
	}

	// Get I/O pipes
	stdin, err := session.StdinPipe()
	if err != nil {
		if closeErr := session.Close(); closeErr != nil {
			t.logger.Error("Failed to close SSH session after stdin pipe error", "error", closeErr, "assetId", t.assetID)
		}
		if closeErr := client.Close(); closeErr != nil {
			t.logger.Error("Failed to close SSH client after stdin pipe error", "error", closeErr, "assetId", t.assetID)
		}
		return fmt.Errorf("failed to get stdin pipe: %w", err)
	}
	t.sshStdin = stdin

	stdout, err := session.StdoutPipe()
	if err != nil {
		if closeErr := session.Close(); closeErr != nil {
			t.logger.Error("Failed to close SSH session after stdout pipe error", "error", closeErr, "assetId", t.assetID)
		}
		if closeErr := client.Close(); closeErr != nil {
			t.logger.Error("Failed to close SSH client after stdout pipe error", "error", closeErr, "assetId", t.assetID)
		}
		return fmt.Errorf("failed to get stdout pipe: %w", err)
	}
	t.sshStdout = stdout

	stderr, err := session.StderrPipe()
	if err != nil {
		if closeErr := session.Close(); closeErr != nil {
			t.logger.Error("Failed to close SSH session after stderr pipe error", "error", closeErr, "assetId", t.assetID)
		}
		if closeErr := client.Close(); closeErr != nil {
			t.logger.Error("Failed to close SSH client after stderr pipe error", "error", closeErr, "assetId", t.assetID)
		}
		return fmt.Errorf("failed to get stderr pipe: %w", err)
	}
	t.sshStderr = stderr

	// Start shell
	if err := session.Shell(); err != nil {
		if closeErr := session.Close(); closeErr != nil {
			t.logger.Error("Failed to close SSH session after shell start error", "error", closeErr, "assetId", t.assetID)
		}
		if closeErr := client.Close(); closeErr != nil {
			t.logger.Error("Failed to close SSH client after shell start error", "error", closeErr, "assetId", t.assetID)
		}
		return fmt.Errorf("failed to start shell: %w", err)
	}

	// Mark terminal ready
	t.readyOnce.Do(func() { close(t.readyChan) })
	return nil
}

// loadPrivateKey loads private key from file (supports optional passphrase)
func (t *Terminal) loadPrivateKey(path string, passphrase string) (ssh.Signer, error) {
	key, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return t.parsePrivateKey(string(key), passphrase)
}

// parsePrivateKey parses private key; if encrypted and passphrase provided, attempts decryption
func (t *Terminal) parsePrivateKey(keyData string, passphrase string) (ssh.Signer, error) {
	signer, err := ssh.ParsePrivateKey([]byte(keyData))
	if err == nil {
		return signer, nil
	}
	// Attempt encrypted key parsing if passphrase given
	if passphrase != "" {
		signerWithPw, perr := ssh.ParsePrivateKeyWithPassphrase([]byte(keyData), []byte(passphrase))
		if perr == nil {
			return signerWithPw, nil
		}
		return nil, perr
	}
	return nil, err
}

// WaitForReady waits terminal ready
func (t *Terminal) WaitForReady() error {
	select {
	case <-t.readyChan:
		return nil
	case <-t.ctx.Done():
		return t.ctx.Err()
	}
}

// Run runs terminal
func (t *Terminal) Run() {
	ctx, cancel := context.WithCancel(t.ctx)
	defer cancel()

	var wg sync.WaitGroup
	wg.Add(2)

	// Periodically send ping to prevent WebSocket disconnect
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				t.writeMutex.Lock()
				if t.conn != nil {
					_ = t.conn.WriteMessage(websocket.PingMessage, nil)
				}
				t.writeMutex.Unlock()
			}
		}
	}()

	// Read terminal output and send to WebSocket
	go func() {
		defer wg.Done()
		t.readFromTerminal(ctx)
	}()

	// Read WebSocket messages and relay to terminal
	go func() {
		defer wg.Done()
		t.readFromWebSocket(ctx)
	}()

	// Wait for goroutines to finish
	wg.Wait()

	// Clean up resources
	t.cleanup()
}

// readFromTerminal reads data from terminal and sends to WebSocket
func (t *Terminal) readFromTerminal(ctx context.Context) {
	type readResult struct {
		data []byte
		err  error
	}

	var readers []io.Reader
	switch t.connType {
	case ConnectionTypeLocal:
		readers = []io.Reader{t.localTty}
	case ConnectionTypeSSH:
		readers = []io.Reader{t.sshStdout, t.sshStderr}
	default:
		t.logger.Error("Unknown connection type", "type", t.connType)
		return
	}

	resultChan := make(chan readResult, len(readers))
	var wg sync.WaitGroup

	for _, reader := range readers {
		wg.Add(1)
		go func(r io.Reader) {
			defer wg.Done()
			buf := make([]byte, 4096)
			for {
				if t.paused {
					time.Sleep(10 * time.Millisecond)
					continue
				}
				n, err := r.Read(buf)
				if n > 0 {
					// Copy data to avoid reusing buffer
					dataCopy := make([]byte, n)
					copy(dataCopy, buf[:n])
					resultChan <- readResult{data: dataCopy, err: nil}
				}
				if err != nil {
					resultChan <- readResult{data: nil, err: err}
					return
				}
			}
		}(reader)
	}

	activeReaders := len(readers)
	for activeReaders > 0 {
		select {
		case <-ctx.Done():
			return
		case res := <-resultChan:
			if res.err != nil {
				if res.err == io.EOF {
					activeReaders--
					continue
				}
				t.logger.Error("Error reading from terminal", "error", res.err)
				activeReaders--
				continue
			}
			if len(res.data) > 0 {
				if err := t.sendDataToWebSocket(res.data); err != nil {
					t.logger.Error("Error sending data to websocket", "error", err)
					return
				}
			}
		}
	}
	wg.Wait()
}

// sendDataToWebSocket safely sends data to WebSocket and captures output
func (t *Terminal) sendDataToWebSocket(data []byte) error {
	t.writeMutex.Lock()
	defer t.writeMutex.Unlock()

	// Ensure WebSocket connection still valid
	if t.conn == nil {
		return fmt.Errorf("websocket connection is nil")
	}

	// Capture terminal output to global manager
	if len(data) > 0 {
		// Convert bytes to string and add to history
		output := string(data)
		//fmt.Println("Terminal Output:", output) // Debug output
		GlobalTerminalManager.AppendOutput(t.sessionID, output)
	}

	// Ensure data is valid UTF-8 text
	const maxChunkSize = 8192
	for i := 0; i < len(data); i += maxChunkSize {
		end := i + maxChunkSize
		if end > len(data) {
			end = len(data)
		}

		chunk := data[i:end]

		// Send raw text data without JSON wrapping
		// Allows frontend to display directly
		err := t.conn.WriteMessage(websocket.BinaryMessage, chunk)
		if err != nil {
			return fmt.Errorf("failed to write websocket message: %w", err)
		}
	}

	return nil
}

// sendConnectionStatus sends connection status
func (t *Terminal) sendConnectionStatus(status, message string) {
	statusMsg := WebSocketMessage{
		Type: "status",
		Data: map[string]interface{}{
			"status":  status,
			"message": message,
		},
	}

	msgBytes, err := json.Marshal(statusMsg)
	if err != nil {
		t.logger.Error("Failed to marshal status message", "error", err)
		return
	}

	t.writeMutex.Lock()
	defer t.writeMutex.Unlock()

	if t.conn != nil {
		err = t.conn.WriteMessage(websocket.TextMessage, msgBytes)
		if err != nil {
			t.logger.Error("Failed to send status message", "error", err)
		}
	}
}

// readFromWebSocket reads data from WebSocket and sends to terminal
func (t *Terminal) readFromWebSocket(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
			msgType, msg, err := t.conn.ReadMessage()
			if err != nil {
				t.logger.Error("Error reading from websocket", "error", err)
				return
			}

			// Handle text messages (JSON)
			if msgType == websocket.TextMessage {
				// Use unified message parser
				m, err := message.ParseMessage(msg)
				if err != nil {
					t.logger.Error("Error parsing websocket message", "error", err)
					continue
				}

				// Dispatch by message type
				switch typedMsg := m.(type) {
				case *message.TermSetSessionId:
					// Handle session ID set message
					t.handleSetSessionId(typedMsg.SessionId)
				case *message.TermInput:
					t.writeToTerminal([]byte(m.(*message.TermInput).Data))
				case *message.TermResize:
					t.resizeTerminal(typedMsg.Rows, typedMsg.Cols)
				case *message.TermPause:
					// Handle pause message
					t.paused = m.(*message.TermPause).Pause
				case *message.TermOutputResponse:
					// Handle output response from frontend
					GlobalOutputManager.HandleOutputResponse(typedMsg)
				default:
					t.logger.Warn("Unknown message type received", "msgType", fmt.Sprintf("%T", m))
				}
			} else if msgType == websocket.BinaryMessage {
				// Binary messages write directly to terminal
				t.writeToTerminal(msg)
			}
		}
	}
}

// handleWebSocketMessage processes legacy WebSocket messages
func (t *Terminal) handleWebSocketMessage(msgType string, msg []byte) {
	switch msgType {
	case "input":
		data := struct {
			Data string `json:"data"`
		}{}
		if err := json.Unmarshal(msg, &data); err != nil {
			t.logger.Error("Failed to unmarshal input data", "error", err)
		}
		t.writeToTerminal([]byte(data.Data))
	case "resize":
		size := struct {
			Data struct {
				Rows int `json:"rows"`
				Cols int `json:"cols"`
			}
		}{}
		err := json.Unmarshal(msg, &size)
		if err != nil {
			t.logger.Error("Failed to unmarshal resize data", "error", err)
		}
		t.resizeTerminal(size.Data.Rows, size.Data.Cols)
	}
}

// writeToTerminal writes data to terminal and captures command
func (t *Terminal) writeToTerminal(data []byte) {
	// Capture user-entered command (simple detection)
	input := string(data)
	if strings.Contains(input, "\r") || strings.Contains(input, "\n") {
		// If contains newline, maybe a complete command
		// Place for more advanced parsing
		if len(strings.TrimSpace(input)) > 0 {
			GlobalTerminalManager.SetLastCommand(t.sessionID, strings.TrimSpace(input))
		}
	}

	switch t.connType {
	case ConnectionTypeLocal:
		if t.localTty != nil {
			if _, err := t.localTty.Write(data); err != nil {
				t.logger.Error("Failed to write to local terminal", "error", err)
			}
		}
	case ConnectionTypeSSH:
		if t.sshStdin != nil {
			if _, err := t.sshStdin.Write(data); err != nil {
				t.logger.Error("Failed to write to SSH stdin", "error", err)
			}
		}
	}
}

// resizeTerminal adjusts terminal size
func (t *Terminal) resizeTerminal(rows, cols int) {
	t.rows = rows
	t.cols = cols

	switch t.connType {
	case ConnectionTypeLocal:
		if t.localTty != nil {
			t.logger.Debug("resizing local terminal", "rows", rows, "cols", cols)
			if err := t.localTty.Resize(cols, rows); err != nil {
				t.logger.Error("Failed to resize local terminal", "error", err)
			}
		}
	case ConnectionTypeSSH:
		if t.sshSession != nil {
			t.logger.Debug("resizing ssh terminal", "rows", rows, "cols", cols)
			if err := t.sshSession.WindowChange(rows, cols); err != nil {
				t.logger.Error("Failed to resize SSH terminal", "error", err, "rows", rows, "cols", cols)
			} else {
				t.logger.Debug("SSH terminal resized successfully", "rows", rows, "cols", cols)
			}
		}
	}
}

// cleanup releases resources
func (t *Terminal) cleanup() {
	switch t.connType {
	case ConnectionTypeLocal:
		if t.localCmd != nil {
			if err := t.localCmd.Process.Kill(); err != nil {
				t.logger.Error("Failed to kill local process", "error", err)
			}
			if err := t.localCmd.Wait(); err != nil {
				t.logger.Error("Local process wait error", "error", err)
			}
		}
		if t.localTty != nil {
			if err := t.localTty.Close(); err != nil {
				t.logger.Error("Failed to close local TTY", "error", err)
			}
		}
	case ConnectionTypeSSH:
		if t.sshSession != nil {
			if err := t.sshSession.Close(); err != nil {
				t.logger.Error("Failed to close SSH session", "error", err)
			}
		}
		if t.sshClient != nil {
			if err := t.sshClient.Close(); err != nil {
				t.logger.Error("Failed to close SSH client", "error", err)
			}
		}
	}
}

// handleSetSessionId handles session ID set message
func (t *Terminal) handleSetSessionId(newSessionID string) {
	oldSessionID := t.sessionID
	t.logger.Info("Updating session ID", "oldSessionID", oldSessionID, "newSessionID", newSessionID)

	// Update terminal session ID
	t.sessionID = newSessionID

	// Update logger session ID
	t.logger = utils.GetLogger().With("sessionID", newSessionID)

	// Register new session ID and migrate data
	GlobalTerminalManager.MigrateSession(oldSessionID, newSessionID, t.assetID, t.conn)
	// Re-attach terminal instance after migration
	GlobalTerminalManager.AttachTerminal(newSessionID, t)

	t.logger.Info("Session ID updated successfully", "sessionID", newSessionID)
}
