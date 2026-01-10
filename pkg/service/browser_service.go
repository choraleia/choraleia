// Package service provides the browser automation service.
// Browsers run in Docker containers using chromedp/headless-shell image.
package service

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/chromedp/chromedp"
	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
	"gorm.io/gorm"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/service/fs"
	"github.com/choraleia/choraleia/pkg/utils"
)

const (
	// DefaultBrowserImage is the default Docker image for headless Chrome
	DefaultBrowserImage = "chromedp/headless-shell:latest"
	// DefaultIdleTimeout is how long a browser can be idle before auto-closing
	DefaultIdleTimeout = 10 * time.Minute
	// DefaultDevToolsPort is the default port for Chrome DevTools Protocol inside container
	DefaultDevToolsPort = 9222
	// MaxBrowsersPerConversation limits concurrent browsers per conversation
	MaxBrowsersPerConversation = 3
	// Browser window size
	BrowserWindowWidth  = 1280
	BrowserWindowHeight = 720
	// BrowserNetworkName is the Docker network for browser containers
	BrowserNetworkName = "choraleia-browser-net"
)

// BrowserStatus represents the current state of a browser instance
type BrowserStatus string

const (
	BrowserStatusStarting BrowserStatus = "starting"
	BrowserStatusReady    BrowserStatus = "ready"
	BrowserStatusBusy     BrowserStatus = "busy"
	BrowserStatusClosed   BrowserStatus = "closed"
	BrowserStatusError    BrowserStatus = "error"
)

// BrowserRuntimeType indicates where the browser is running
type BrowserRuntimeType string

const (
	BrowserRuntimeLocal     BrowserRuntimeType = "local"      // Local docker
	BrowserRuntimeRemoteSSH BrowserRuntimeType = "remote-ssh" // Remote docker via SSH
)

// BrowserInstance represents a running browser in a Docker container
type BrowserInstance struct {
	ID             string             `json:"id"`
	ConversationID string             `json:"conversation_id"`
	WorkspaceID    string             `json:"workspace_id"`
	ContainerID    string             `json:"container_id"`
	ContainerName  string             `json:"container_name"`
	ContainerIP    string             `json:"container_ip"`
	RuntimeType    BrowserRuntimeType `json:"runtime_type"`
	DevToolsURL    string             `json:"devtools_url"`
	DevToolsPort   int                `json:"devtools_port"`
	CurrentURL     string             `json:"current_url"`
	CurrentTitle   string             `json:"current_title"`
	Status         BrowserStatus      `json:"status"`
	ErrorMessage   string             `json:"error_message,omitempty"`
	CreatedAt      time.Time          `json:"created_at"`
	LastActivityAt time.Time          `json:"last_activity_at"`

	// Tabs management
	Tabs      []BrowserTab `json:"tabs"`
	ActiveTab int          `json:"active_tab"`

	// SSH tunnel info (for remote browsers)
	SSHAssetID  string `json:"ssh_asset_id,omitempty"`
	TunnelLocal int    `json:"tunnel_local_port,omitempty"`

	// Internal chromedp context (not serialized)
	allocCtx    context.Context
	allocCancel context.CancelFunc
	ctx         context.Context
	cancel      context.CancelFunc
	tunnel      io.Closer // SSH tunnel closer
	mu          sync.Mutex
}

// BrowserTab represents a browser tab
type BrowserTab struct {
	ID    string `json:"id"`
	URL   string `json:"url"`
	Title string `json:"title"`

	// Internal chromedp context for this tab (not serialized)
	ctx    context.Context    `json:"-"`
	cancel context.CancelFunc `json:"-"`
}

// ScrollInfo represents the scroll state of a page
type ScrollInfo struct {
	ScrollX       int  `json:"scroll_x"`        // Current horizontal scroll position
	ScrollY       int  `json:"scroll_y"`        // Current vertical scroll position
	ScrollWidth   int  `json:"scroll_width"`    // Total scrollable width
	ScrollHeight  int  `json:"scroll_height"`   // Total scrollable height
	ClientWidth   int  `json:"client_width"`    // Viewport width
	ClientHeight  int  `json:"client_height"`   // Viewport height
	HasScrollbarX bool `json:"has_scrollbar_x"` // Whether horizontal scrollbar exists
	HasScrollbarY bool `json:"has_scrollbar_y"` // Whether vertical scrollbar exists
	AtTop         bool `json:"at_top"`          // Whether scrolled to top
	AtBottom      bool `json:"at_bottom"`       // Whether scrolled to bottom
	AtLeft        bool `json:"at_left"`         // Whether scrolled to left
	AtRight       bool `json:"at_right"`        // Whether scrolled to right
	PercentX      int  `json:"percent_x"`       // Horizontal scroll percentage (0-100)
	PercentY      int  `json:"percent_y"`       // Vertical scroll percentage (0-100)
}

// BrowserService manages browser instances running in Docker containers
type BrowserService struct {
	db          *gorm.DB
	browsers    map[string]*BrowserInstance // browserID -> instance
	byConv      map[string][]string         // conversationID -> []browserID
	mu          sync.RWMutex
	logger      *slog.Logger
	idleTimeout time.Duration
	stopCleanup chan struct{}

	// Dependencies
	sshPool      *fs.SSHPool
	assetService *AssetService

	// Track network creation per host
	networksCreated map[string]bool // host -> created
	networkMu       sync.Mutex

	// Callback for browser state changes (for WebSocket notifications)
	onStateChange func(browserID string, instance *BrowserInstance)
}

// NewBrowserService creates a new browser service
func NewBrowserService() *BrowserService {
	s := &BrowserService{
		browsers:        make(map[string]*BrowserInstance),
		byConv:          make(map[string][]string),
		logger:          utils.GetLogger(),
		idleTimeout:     DefaultIdleTimeout,
		stopCleanup:     make(chan struct{}),
		networksCreated: make(map[string]bool),
	}

	// Start cleanup goroutine
	go s.cleanupLoop()

	return s
}

// SetDB sets the database connection and runs migrations
func (s *BrowserService) SetDB(db *gorm.DB) error {
	s.db = db
	if db != nil {
		// Auto migrate browser instance table
		if err := db.AutoMigrate(&models.BrowserInstanceRecord{}); err != nil {
			return fmt.Errorf("failed to migrate browser_instances table: %w", err)
		}
		// Clean up stale browser instances on startup
		s.cleanupStaleInstances()
	}
	return nil
}

// cleanupStaleInstances attempts to reconnect to browser instances on startup
// Timeout cleanup is handled by the periodic cleanupIdleBrowsers
func (s *BrowserService) cleanupStaleInstances() {
	if s.db == nil {
		return
	}

	// Find all non-closed instances from database
	var records []models.BrowserInstanceRecord
	if err := s.db.Where("status != ?", models.BrowserInstanceStatusClosed).Find(&records).Error; err != nil {
		s.logger.Warn("Failed to query stale browser instances", "error", err)
		return
	}

	if len(records) == 0 {
		return
	}

	s.logger.Info("Found non-closed browser instances on startup", "count", len(records))

	var reconnectedCount int

	for _, record := range records {
		// Try to reconnect to browser
		if s.tryReconnectBrowser(&record) {
			reconnectedCount++
			s.logger.Info("Reconnected to browser", "browserID", record.ID)
		} else {
			// Failed to reconnect - will be cleaned up by periodic cleanupIdleBrowsers
			s.logger.Debug("Failed to reconnect browser, will be cleaned up later", "browserID", record.ID)
		}
	}

	s.logger.Info("Startup browser reconnection completed", "reconnected", reconnectedCount, "total", len(records))
}

// tryStopContainer attempts to stop a container based on the record
func (s *BrowserService) tryStopContainer(record models.BrowserInstanceRecord) {
	if record.ContainerID == "" && record.ContainerName == "" {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	containerRef := record.ContainerID
	if containerRef == "" {
		containerRef = record.ContainerName
	}

	switch record.RuntimeType {
	case models.BrowserRuntimeLocal:
		exec.CommandContext(ctx, "docker", "stop", containerRef).Run()
		exec.CommandContext(ctx, "docker", "rm", "-f", containerRef).Run()
	case models.BrowserRuntimeRemoteSSH:
		if record.SSHAssetID != "" && s.sshPool != nil {
			if client, err := s.sshPool.GetSSHClient(record.SSHAssetID); err == nil {
				session, _ := client.NewSession()
				if session != nil {
					session.Run(fmt.Sprintf("docker stop %s; docker rm -f %s", containerRef, containerRef))
					session.Close()
				}
			}
		}
	}
}

// tryReconnectBrowser attempts to reconnect to a browser container
func (s *BrowserService) tryReconnectBrowser(record *models.BrowserInstanceRecord) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Check if container is still running
	if !s.isContainerRunning(ctx, record) {
		return false
	}

	// Create browser instance from record
	instance := &BrowserInstance{
		ID:             record.ID,
		ConversationID: record.ConversationID,
		WorkspaceID:    record.WorkspaceID,
		ContainerID:    record.ContainerID,
		ContainerName:  record.ContainerName,
		ContainerIP:    record.ContainerIP,
		RuntimeType:    BrowserRuntimeType(record.RuntimeType),
		DevToolsURL:    record.DevToolsURL,
		DevToolsPort:   record.DevToolsPort,
		CurrentURL:     record.CurrentURL,
		CurrentTitle:   record.CurrentTitle,
		Status:         BrowserStatusStarting,
		SSHAssetID:     record.SSHAssetID,
		CreatedAt:      record.CreatedAt,
		LastActivityAt: record.LastActivityAt,
		ActiveTab:      record.ActiveTab,
		Tabs:           make([]BrowserTab, len(record.Tabs)),
	}

	// Convert tabs
	for i, tab := range record.Tabs {
		instance.Tabs[i] = BrowserTab{
			ID:    tab.ID,
			URL:   tab.URL,
			Title: tab.Title,
		}
	}

	// Try to reconnect based on runtime type
	var err error
	switch record.RuntimeType {
	case models.BrowserRuntimeLocal:
		err = s.reconnectLocalBrowser(ctx, instance)
	case models.BrowserRuntimeRemoteSSH:
		err = s.reconnectRemoteSSHBrowser(ctx, instance)
	}

	if err != nil {
		s.logger.Debug("Failed to reconnect browser", "browserID", record.ID, "error", err)
		return false
	}

	// Set status to ready before adding to maps and saving
	instance.mu.Lock()
	instance.Status = BrowserStatusReady
	instance.mu.Unlock()

	// Add to in-memory maps
	s.mu.Lock()
	s.browsers[instance.ID] = instance
	s.byConv[instance.ConversationID] = append(s.byConv[instance.ConversationID], instance.ID)
	s.mu.Unlock()

	// Save updated state to database
	if s.db != nil {
		s.saveInstanceToDB(instance)
	}

	s.notifyStateChange(instance.ID, instance)
	return true
}

// isContainerRunning checks if a container is still running
func (s *BrowserService) isContainerRunning(ctx context.Context, record *models.BrowserInstanceRecord) bool {
	containerRef := record.ContainerID
	if containerRef == "" {
		containerRef = record.ContainerName
	}
	if containerRef == "" {
		return false
	}

	switch record.RuntimeType {
	case models.BrowserRuntimeLocal:
		cmd := exec.CommandContext(ctx, "docker", "inspect", "-f", "{{.State.Running}}", containerRef)
		output, err := cmd.Output()
		if err != nil {
			return false
		}
		return strings.TrimSpace(string(output)) == "true"

	case models.BrowserRuntimeRemoteSSH:
		if record.SSHAssetID == "" || s.sshPool == nil {
			return false
		}
		client, err := s.sshPool.GetSSHClient(record.SSHAssetID)
		if err != nil {
			return false
		}
		session, err := client.NewSession()
		if err != nil {
			return false
		}
		defer session.Close()
		output, err := session.Output(fmt.Sprintf("docker inspect -f '{{.State.Running}}' %s", containerRef))
		if err != nil {
			return false
		}
		return strings.TrimSpace(string(output)) == "true"
	}

	return false
}

// reconnectLocalBrowser reconnects to a local browser container
func (s *BrowserService) reconnectLocalBrowser(ctx context.Context, instance *BrowserInstance) error {
	// Get container IP if not set
	if instance.ContainerIP == "" {
		execFn := func(ctx context.Context, args ...string) (string, error) {
			cmd := exec.CommandContext(ctx, args[0], args[1:]...)
			output, err := cmd.CombinedOutput()
			return string(output), err
		}
		containerRef := instance.ContainerID
		if containerRef == "" {
			containerRef = instance.ContainerName
		}
		ip, err := s.getContainerIP(ctx, containerRef, execFn)
		if err != nil {
			return fmt.Errorf("failed to get container IP: %w", err)
		}
		instance.ContainerIP = ip
	}

	// Wait for browser to be ready
	if err := s.waitForBrowserReady(ctx, instance.ContainerIP, DefaultDevToolsPort); err != nil {
		return fmt.Errorf("browser not ready: %w", err)
	}

	// Reconnect chromedp without navigating (preserve browser state)
	wsURL := fmt.Sprintf("ws://%s:%d", instance.ContainerIP, DefaultDevToolsPort)
	if err := s.doReconnectChromedp(instance, wsURL); err != nil {
		return fmt.Errorf("failed to reconnect chromedp: %w", err)
	}

	return nil
}

// reconnectRemoteSSHBrowser reconnects to a remote browser via SSH tunnel
func (s *BrowserService) reconnectRemoteSSHBrowser(ctx context.Context, instance *BrowserInstance) error {
	if s.sshPool == nil {
		return fmt.Errorf("SSH pool not available")
	}
	if instance.SSHAssetID == "" {
		return fmt.Errorf("SSH asset ID not specified")
	}

	// Get SSH client
	client, err := s.sshPool.GetSSHClient(instance.SSHAssetID)
	if err != nil {
		return fmt.Errorf("failed to get SSH connection: %w", err)
	}

	// Get container IP if not set
	if instance.ContainerIP == "" {
		execFn := func(ctx context.Context, args ...string) (string, error) {
			cmd := strings.Join(args, " ")
			session, err := client.NewSession()
			if err != nil {
				return "", err
			}
			defer session.Close()
			output, err := session.CombinedOutput(cmd)
			return string(output), err
		}
		containerRef := instance.ContainerID
		if containerRef == "" {
			containerRef = instance.ContainerName
		}
		ip, err := s.getContainerIP(ctx, containerRef, execFn)
		if err != nil {
			return fmt.Errorf("failed to get container IP: %w", err)
		}
		instance.ContainerIP = ip
	}

	// Create SSH tunnel
	localPort, tunnel, err := s.createSSHTunnel(client, instance.ContainerIP, DefaultDevToolsPort)
	if err != nil {
		return fmt.Errorf("failed to create SSH tunnel: %w", err)
	}
	instance.TunnelLocal = localPort
	instance.tunnel = tunnel
	instance.DevToolsURL = fmt.Sprintf("ws://127.0.0.1:%d", localPort)

	// Wait for browser to be ready via tunnel
	if err := s.waitForBrowserReady(ctx, "127.0.0.1", localPort); err != nil {
		tunnel.Close()
		return fmt.Errorf("browser not ready: %w", err)
	}

	// Reconnect chromedp via tunnel without navigating (preserve browser state)
	wsURL := fmt.Sprintf("ws://127.0.0.1:%d", localPort)
	if err := s.doReconnectChromedp(instance, wsURL); err != nil {
		tunnel.Close()
		return fmt.Errorf("failed to reconnect chromedp: %w", err)
	}

	return nil
}

// cleanupOrphanedContainers removes any browser containers that were left running
func (s *BrowserService) cleanupOrphanedContainers() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Find containers with our label
	cmd := exec.CommandContext(ctx, "docker", "ps", "-a", "-q", "--filter", "label=managed-by=choraleia-browser")
	output, err := cmd.Output()
	if err != nil {
		s.logger.Debug("Failed to list orphaned browser containers", "error", err)
		return
	}

	containerIDs := strings.Fields(string(output))
	if len(containerIDs) == 0 {
		return
	}

	s.logger.Info("Cleaning up orphaned browser containers", "count", len(containerIDs))

	for _, containerID := range containerIDs {
		exec.CommandContext(ctx, "docker", "rm", "-f", containerID).Run()
	}
}

// SetSSHPool sets the SSH pool for remote connections
func (s *BrowserService) SetSSHPool(pool *fs.SSHPool) {
	s.sshPool = pool
}

// SetAssetService sets the asset service
func (s *BrowserService) SetAssetService(as *AssetService) {
	s.assetService = as
}

// SetOnStateChange sets the callback for browser state changes
func (s *BrowserService) SetOnStateChange(fn func(browserID string, instance *BrowserInstance)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onStateChange = fn
}

// notifyStateChange notifies listeners of browser state changes
func (s *BrowserService) notifyStateChange(browserID string, instance *BrowserInstance) {
	s.mu.RLock()
	fn := s.onStateChange
	s.mu.RUnlock()

	if fn != nil {
		fn(browserID, instance)
	}
}

// StartBrowser starts a new browser instance based on workspace runtime
func (s *BrowserService) StartBrowser(ctx context.Context, conversationID string) (*BrowserInstance, error) {
	// For now, start with local runtime. The workspace context should be passed
	// to determine the actual runtime type.
	return s.StartBrowserWithRuntime(ctx, conversationID, "", nil)
}

// StartBrowserWithRuntime starts a new browser with specific runtime configuration
func (s *BrowserService) StartBrowserWithRuntime(ctx context.Context, conversationID string, workspaceID string, runtime *models.WorkspaceRuntime) (*BrowserInstance, error) {
	s.mu.Lock()

	// Check max browsers per conversation
	if len(s.byConv[conversationID]) >= MaxBrowsersPerConversation {
		s.mu.Unlock()
		return nil, fmt.Errorf("maximum browsers (%d) reached for this conversation", MaxBrowsersPerConversation)
	}

	// Determine runtime type
	runtimeType := BrowserRuntimeLocal
	var sshAssetID string

	if runtime != nil {
		switch runtime.Type {
		case models.RuntimeTypeLocal, models.RuntimeTypeDockerLocal:
			runtimeType = BrowserRuntimeLocal
		case models.RuntimeTypeDockerRemote:
			runtimeType = BrowserRuntimeRemoteSSH
			if runtime.DockerAssetID != nil {
				sshAssetID = *runtime.DockerAssetID
			}
		}
	}

	// Generate browser ID
	browserID := uuid.New().String()
	containerName := fmt.Sprintf("choraleia-browser-%s", browserID[:12])

	instance := &BrowserInstance{
		ID:             browserID,
		ConversationID: conversationID,
		WorkspaceID:    workspaceID,
		ContainerName:  containerName,
		RuntimeType:    runtimeType,
		SSHAssetID:     sshAssetID,
		Status:         BrowserStatusStarting,
		CreatedAt:      time.Now(),
		LastActivityAt: time.Now(),
		Tabs:           []BrowserTab{},
		ActiveTab:      0,
	}

	s.browsers[browserID] = instance
	s.byConv[conversationID] = append(s.byConv[conversationID], browserID)
	s.mu.Unlock()

	// Save initial state to database
	s.saveInstanceToDB(instance)

	s.notifyStateChange(browserID, instance)

	// Start container based on runtime type
	var err error
	switch runtimeType {
	case BrowserRuntimeLocal:
		err = s.startLocalBrowser(ctx, instance)
	case BrowserRuntimeRemoteSSH:
		err = s.startRemoteSSHBrowser(ctx, instance)
	}

	if err != nil {
		s.logger.Error("Failed to start browser container", "browserID", browserID, "runtimeType", runtimeType, "error", err)
		instance.mu.Lock()
		instance.Status = BrowserStatusError
		instance.ErrorMessage = err.Error()
		instance.mu.Unlock()
		s.notifyStateChange(browserID, instance)
		s.saveInstanceToDB(instance) // Save error state to DB
		return instance, err
	}

	// Save to database
	s.saveInstanceToDB(instance)

	return instance, nil
}

// saveInstanceToDB saves a browser instance to the database
func (s *BrowserService) saveInstanceToDB(instance *BrowserInstance) {
	if s.db == nil {
		return
	}

	instance.mu.Lock()
	tabs := make(models.BrowserTabList, len(instance.Tabs))
	for i, tab := range instance.Tabs {
		tabs[i] = models.BrowserTabInfo{
			ID:    tab.ID,
			URL:   tab.URL,
			Title: tab.Title,
		}
	}

	record := &models.BrowserInstanceRecord{
		ID:             instance.ID,
		ConversationID: instance.ConversationID,
		WorkspaceID:    instance.WorkspaceID,
		ContainerID:    instance.ContainerID,
		ContainerName:  instance.ContainerName,
		ContainerIP:    instance.ContainerIP,
		RuntimeType:    models.BrowserRuntimeType(instance.RuntimeType),
		DevToolsURL:    instance.DevToolsURL,
		DevToolsPort:   instance.DevToolsPort,
		CurrentURL:     instance.CurrentURL,
		CurrentTitle:   instance.CurrentTitle,
		Status:         models.BrowserInstanceStatus(instance.Status),
		ErrorMessage:   instance.ErrorMessage,
		SSHAssetID:     instance.SSHAssetID,
		Tabs:           tabs,
		ActiveTab:      instance.ActiveTab,
		CreatedAt:      instance.CreatedAt,
		LastActivityAt: instance.LastActivityAt,
	}
	instance.mu.Unlock()

	// Use upsert (save or update)
	if err := s.db.Save(record).Error; err != nil {
		s.logger.Warn("Failed to save browser instance to DB", "browserID", instance.ID, "error", err)
	}
}

// updateInstanceInDB updates specific fields of a browser instance in the database
func (s *BrowserService) updateInstanceInDB(browserID string, updates map[string]interface{}) {
	if s.db == nil {
		return
	}

	if err := s.db.Model(&models.BrowserInstanceRecord{}).Where("id = ?", browserID).Updates(updates).Error; err != nil {
		s.logger.Warn("Failed to update browser instance in DB", "browserID", browserID, "error", err)
	}
}

// ensureDockerNetwork ensures the browser network exists
func (s *BrowserService) ensureDockerNetwork(ctx context.Context, execFn func(ctx context.Context, args ...string) (string, error)) error {
	// Check if network exists
	output, err := execFn(ctx, "docker", "network", "inspect", BrowserNetworkName)
	if err == nil && output != "" {
		return nil // Network exists
	}

	// Create network
	_, err = execFn(ctx, "docker", "network", "create", "--driver", "bridge", BrowserNetworkName)
	if err != nil {
		// Check if it's because network already exists (race condition)
		if strings.Contains(err.Error(), "already exists") {
			return nil
		}
		return fmt.Errorf("failed to create docker network: %w", err)
	}

	s.logger.Info("Created browser network", "network", BrowserNetworkName)
	return nil
}

// startLocalBrowser starts a browser on local docker
func (s *BrowserService) startLocalBrowser(ctx context.Context, instance *BrowserInstance) error {
	// Local command executor
	execFn := func(ctx context.Context, args ...string) (string, error) {
		cmd := exec.CommandContext(ctx, args[0], args[1:]...)
		output, err := cmd.CombinedOutput()
		return string(output), err
	}

	// Ensure network exists
	s.networkMu.Lock()
	if !s.networksCreated["local"] {
		if err := s.ensureDockerNetwork(ctx, execFn); err != nil {
			s.networkMu.Unlock()
			return err
		}
		s.networksCreated["local"] = true
	}
	s.networkMu.Unlock()

	// Start container
	args := s.buildDockerRunArgs(instance)
	output, err := execFn(ctx, args...)
	if err != nil {
		return fmt.Errorf("failed to start container: %w, output: %s", err, output)
	}

	instance.ContainerID = strings.TrimSpace(output)
	s.logger.Info("Browser container started", "browserID", instance.ID, "containerID", instance.ContainerID[:12])

	// Get container IP
	ip, err := s.getContainerIP(ctx, instance.ContainerID, execFn)
	if err != nil {
		s.stopContainerLocal(instance.ContainerID)
		return fmt.Errorf("failed to get container IP: %w", err)
	}
	instance.ContainerIP = ip
	instance.DevToolsPort = DefaultDevToolsPort
	instance.DevToolsURL = fmt.Sprintf("ws://%s:%d", ip, DefaultDevToolsPort)

	// Wait for browser to be ready
	if err := s.waitForBrowserReady(ctx, instance.ContainerIP, DefaultDevToolsPort); err != nil {
		s.stopContainerLocal(instance.ContainerID)
		return fmt.Errorf("browser not ready: %w", err)
	}

	// Connect chromedp
	if err := s.connectChromedp(instance); err != nil {
		s.stopContainerLocal(instance.ContainerID)
		return fmt.Errorf("failed to connect chromedp: %w", err)
	}

	instance.mu.Lock()
	instance.Status = BrowserStatusReady
	instance.mu.Unlock()

	s.notifyStateChange(instance.ID, instance)
	s.logger.Info("Browser ready", "browserID", instance.ID, "containerIP", ip)

	return nil
}

// startRemoteSSHBrowser starts a browser on remote docker via SSH
func (s *BrowserService) startRemoteSSHBrowser(ctx context.Context, instance *BrowserInstance) error {
	if s.sshPool == nil {
		return fmt.Errorf("SSH pool not available")
	}
	if instance.SSHAssetID == "" {
		return fmt.Errorf("SSH asset ID not specified")
	}

	// Get SSH client
	client, err := s.sshPool.GetSSHClient(instance.SSHAssetID)
	if err != nil {
		return fmt.Errorf("failed to get SSH connection: %w", err)
	}

	// SSH command executor
	execFn := func(ctx context.Context, args ...string) (string, error) {
		cmd := strings.Join(args, " ")
		session, err := client.NewSession()
		if err != nil {
			return "", err
		}
		defer session.Close()

		output, err := session.CombinedOutput(cmd)
		return string(output), err
	}

	// Ensure network exists on remote
	s.networkMu.Lock()
	networkKey := fmt.Sprintf("ssh:%s", instance.SSHAssetID)
	if !s.networksCreated[networkKey] {
		if err := s.ensureDockerNetwork(ctx, execFn); err != nil {
			s.networkMu.Unlock()
			return err
		}
		s.networksCreated[networkKey] = true
	}
	s.networkMu.Unlock()

	// Build and execute docker run command
	args := s.buildDockerRunArgs(instance)
	cmdStr := strings.Join(args, " ")

	session, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create SSH session: %w", err)
	}
	output, err := session.CombinedOutput(cmdStr)
	session.Close()

	if err != nil {
		return fmt.Errorf("failed to start container: %w, output: %s", err, string(output))
	}

	instance.ContainerID = strings.TrimSpace(string(output))
	s.logger.Info("Remote browser container started", "browserID", instance.ID, "containerID", instance.ContainerID[:12])

	// Get container IP on remote
	ip, err := s.getContainerIP(ctx, instance.ContainerID, execFn)
	if err != nil {
		s.stopContainerRemote(instance.ContainerID, client)
		return fmt.Errorf("failed to get container IP: %w", err)
	}
	instance.ContainerIP = ip
	instance.DevToolsPort = DefaultDevToolsPort

	// Create SSH tunnel to container
	localPort, tunnel, err := s.createSSHTunnel(client, ip, DefaultDevToolsPort)
	if err != nil {
		s.stopContainerRemote(instance.ContainerID, client)
		return fmt.Errorf("failed to create SSH tunnel: %w", err)
	}
	instance.TunnelLocal = localPort
	instance.tunnel = tunnel
	instance.DevToolsURL = fmt.Sprintf("ws://127.0.0.1:%d", localPort)

	// Wait for browser to be ready via tunnel
	if err := s.waitForBrowserReady(ctx, "127.0.0.1", localPort); err != nil {
		tunnel.Close()
		s.stopContainerRemote(instance.ContainerID, client)
		return fmt.Errorf("browser not ready: %w", err)
	}

	// Connect chromedp via tunnel
	if err := s.connectChromedpTunnel(instance, localPort); err != nil {
		tunnel.Close()
		s.stopContainerRemote(instance.ContainerID, client)
		return fmt.Errorf("failed to connect chromedp: %w", err)
	}

	instance.mu.Lock()
	instance.Status = BrowserStatusReady
	instance.mu.Unlock()

	s.notifyStateChange(instance.ID, instance)
	s.logger.Info("Remote browser ready", "browserID", instance.ID, "containerIP", ip, "tunnelPort", localPort)

	return nil
}

// buildDockerRunArgs builds the docker run command arguments
func (s *BrowserService) buildDockerRunArgs(instance *BrowserInstance) []string {
	// Note: chromedp/headless-shell image has an entrypoint that already configures
	// Chrome with --remote-debugging-port=9222, so we don't need to pass Chrome flags.
	// The image uses socat to forward 9222 -> 9223 internally.
	return []string{
		"docker", "run", "-d",
		"--name", instance.ContainerName,
		"--network", BrowserNetworkName,
		"--label", "managed-by=choraleia-browser",
		"--label", fmt.Sprintf("browser-id=%s", instance.ID),
		"--label", fmt.Sprintf("conversation-id=%s", instance.ConversationID),
		"--memory=1g",
		"--cpus=1",
		"--shm-size=512m",
		// Mount host fonts for CJK support
		"-v", "/usr/share/fonts:/usr/share/fonts:ro",
		DefaultBrowserImage,
		// Only pass the URL to open, the image handles Chrome flags
		"about:blank",
	}
}

// getContainerIP gets the IP address of a container
func (s *BrowserService) getContainerIP(ctx context.Context, containerID string, execFn func(ctx context.Context, args ...string) (string, error)) (string, error) {
	// Wait a moment for container to get IP
	time.Sleep(1 * time.Second)

	// Use index to access network with hyphens in name
	// Format: {{(index .NetworkSettings.Networks "network-name").IPAddress}}
	template := fmt.Sprintf(`{{(index .NetworkSettings.Networks "%s").IPAddress}}`, BrowserNetworkName)
	output, err := execFn(ctx, "docker", "inspect", "-f", template, containerID)
	if err != nil {
		s.logger.Error("Failed to get container IP", "containerID", containerID, "error", err, "output", output)
		return "", fmt.Errorf("docker inspect failed: %w", err)
	}

	ip := strings.TrimSpace(output)
	if ip == "" {
		return "", fmt.Errorf("container has no IP address in network %s", BrowserNetworkName)
	}

	return ip, nil
}

// waitForBrowserReady waits for the browser to be ready
func (s *BrowserService) waitForBrowserReady(ctx context.Context, host string, port int) error {
	timeout := time.After(30 * time.Second)
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	checkURL := fmt.Sprintf("http://%s:%d/json/version", host, port)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timeout:
			return fmt.Errorf("timeout waiting for browser to start")
		case <-ticker.C:
			resp, err := http.Get(checkURL)
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode == 200 {
					return nil
				}
			}
		}
	}
}

// connectChromedp establishes chromedp connection to a local browser
func (s *BrowserService) connectChromedp(instance *BrowserInstance) error {
	wsURL := fmt.Sprintf("ws://%s:%d", instance.ContainerIP, DefaultDevToolsPort)
	return s.doConnectChromedp(instance, wsURL)
}

// connectChromedpTunnel establishes chromedp connection via SSH tunnel
func (s *BrowserService) connectChromedpTunnel(instance *BrowserInstance, localPort int) error {
	wsURL := fmt.Sprintf("ws://127.0.0.1:%d", localPort)
	return s.doConnectChromedp(instance, wsURL)
}

// doConnectChromedp performs the actual chromedp connection
func (s *BrowserService) doConnectChromedp(instance *BrowserInstance, wsURL string) error {
	allocCtx, allocCancel := chromedp.NewRemoteAllocator(
		context.Background(),
		wsURL,
	)
	instance.allocCtx = allocCtx
	instance.allocCancel = allocCancel

	// Create first tab context
	ctx, cancel := chromedp.NewContext(allocCtx)
	instance.ctx = ctx
	instance.cancel = cancel

	// Set viewport size and navigate to blank page
	if err := chromedp.Run(ctx,
		chromedp.EmulateViewport(int64(BrowserWindowWidth), int64(BrowserWindowHeight)),
		chromedp.Navigate("about:blank"),
	); err != nil {
		allocCancel()
		return err
	}

	// Initialize tabs with context
	instance.Tabs = []BrowserTab{
		{ID: "tab-0", URL: "about:blank", Title: "New Tab", ctx: ctx, cancel: cancel},
	}
	instance.ActiveTab = 0

	return nil
}

// doReconnectChromedp reconnects to an existing browser without navigating
// This preserves the browser's current state after program restart
func (s *BrowserService) doReconnectChromedp(instance *BrowserInstance, wsURL string) error {
	allocCtx, allocCancel := chromedp.NewRemoteAllocator(
		context.Background(),
		wsURL,
	)
	instance.allocCtx = allocCtx
	instance.allocCancel = allocCancel

	// Create context to attach to existing browser
	ctx, cancel := chromedp.NewContext(allocCtx)
	instance.ctx = ctx
	instance.cancel = cancel

	// Just set viewport, don't navigate - preserve existing page
	if err := chromedp.Run(ctx,
		chromedp.EmulateViewport(int64(BrowserWindowWidth), int64(BrowserWindowHeight)),
	); err != nil {
		allocCancel()
		return err
	}

	// Get current page URL and title
	var currentURL, currentTitle string
	chromedp.Run(ctx,
		chromedp.Location(&currentURL),
		chromedp.Title(&currentTitle),
	)

	// Update instance with current browser state
	instance.CurrentURL = currentURL
	instance.CurrentTitle = currentTitle

	// Recreate tab entry with context (single tab for now, as chromedp reconnects to one target)
	instance.Tabs = []BrowserTab{
		{ID: "tab-0", URL: currentURL, Title: currentTitle, ctx: ctx, cancel: cancel},
	}
	instance.ActiveTab = 0

	return nil
}

// createSSHTunnel creates an SSH tunnel to the remote container
func (s *BrowserService) createSSHTunnel(client *ssh.Client, remoteHost string, remotePort int) (int, io.Closer, error) {
	// Find available local port
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, nil, fmt.Errorf("failed to find available port: %w", err)
	}

	localPort := listener.Addr().(*net.TCPAddr).Port

	// Start tunnel goroutine
	stopCh := make(chan struct{})
	go func() {
		for {
			select {
			case <-stopCh:
				listener.Close()
				return
			default:
			}

			conn, err := listener.Accept()
			if err != nil {
				select {
				case <-stopCh:
					return
				default:
					continue
				}
			}

			go func(conn net.Conn) {
				defer conn.Close()

				// Connect to remote through SSH
				remoteConn, err := client.Dial("tcp", fmt.Sprintf("%s:%d", remoteHost, remotePort))
				if err != nil {
					s.logger.Debug("SSH tunnel dial failed", "error", err)
					return
				}
				defer remoteConn.Close()

				// Bidirectional copy
				done := make(chan struct{}, 2)
				go func() {
					io.Copy(remoteConn, conn)
					done <- struct{}{}
				}()
				go func() {
					io.Copy(conn, remoteConn)
					done <- struct{}{}
				}()
				<-done
			}(conn)
		}
	}()

	// Return a closer that stops the tunnel
	closer := &tunnelCloser{
		stopCh:   stopCh,
		listener: listener,
	}

	s.logger.Info("SSH tunnel created", "localPort", localPort, "remoteHost", remoteHost, "remotePort", remotePort)
	return localPort, closer, nil
}

type tunnelCloser struct {
	stopCh   chan struct{}
	listener net.Listener
}

func (t *tunnelCloser) Close() error {
	close(t.stopCh)
	return t.listener.Close()
}

// stopContainerLocal stops a local container
func (s *BrowserService) stopContainerLocal(containerID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	s.logger.Info("Stopping local browser container", "containerID", containerID)

	exec.CommandContext(ctx, "docker", "stop", containerID).Run()
	exec.CommandContext(ctx, "docker", "rm", "-f", containerID).Run()
}

// stopContainerRemote stops a remote container via SSH
func (s *BrowserService) stopContainerRemote(containerID string, client *ssh.Client) {
	s.logger.Info("Stopping remote browser container", "containerID", containerID)

	session, err := client.NewSession()
	if err != nil {
		s.logger.Warn("Failed to create SSH session for container stop", "error", err)
		return
	}
	session.Run(fmt.Sprintf("docker stop %s && docker rm -f %s", containerID, containerID))
	session.Close()
}

// GetBrowser returns a browser instance by ID
func (s *BrowserService) GetBrowser(browserID string) (*BrowserInstance, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	instance, ok := s.browsers[browserID]
	if !ok {
		return nil, fmt.Errorf("browser not found: %s", browserID)
	}
	return instance, nil
}

// ListBrowsers returns all browsers for a conversation (active in memory)
func (s *BrowserService) ListBrowsers(conversationID string) []*BrowserInstance {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*BrowserInstance
	for _, browserID := range s.byConv[conversationID] {
		if instance, ok := s.browsers[browserID]; ok {
			result = append(result, instance)
		}
	}
	return result
}

// ListBrowsersFromDB returns all browser records for a conversation from database
// including closed browsers (useful for history)
func (s *BrowserService) ListBrowsersFromDB(conversationID string) ([]*models.BrowserInstanceRecord, error) {
	if s.db == nil {
		return nil, fmt.Errorf("database not available")
	}

	var records []*models.BrowserInstanceRecord
	if err := s.db.Where("conversation_id = ?", conversationID).Order("created_at DESC").Find(&records).Error; err != nil {
		return nil, err
	}
	return records, nil
}

// CloseBrowser closes a browser instance and its container
func (s *BrowserService) CloseBrowser(browserID string) error {
	s.mu.Lock()
	instance, ok := s.browsers[browserID]
	if !ok {
		s.mu.Unlock()
		return fmt.Errorf("browser not found: %s", browserID)
	}

	// Remove from maps
	delete(s.browsers, browserID)
	convBrowsers := s.byConv[instance.ConversationID]
	for i, id := range convBrowsers {
		if id == browserID {
			s.byConv[instance.ConversationID] = append(convBrowsers[:i], convBrowsers[i+1:]...)
			break
		}
	}
	s.mu.Unlock()

	// Cancel all tab contexts first
	for _, tab := range instance.Tabs {
		if tab.cancel != nil {
			tab.cancel()
		}
	}

	// Cancel allocator context
	if instance.allocCancel != nil {
		instance.allocCancel()
	}

	// Close SSH tunnel if exists
	if instance.tunnel != nil {
		instance.tunnel.Close()
	}

	// Stop container based on runtime type
	switch instance.RuntimeType {
	case BrowserRuntimeLocal:
		if instance.ContainerID != "" {
			s.stopContainerLocal(instance.ContainerID)
		} else if instance.ContainerName != "" {
			s.stopContainerLocal(instance.ContainerName)
		}
	case BrowserRuntimeRemoteSSH:
		containerRef := instance.ContainerID
		if containerRef == "" {
			containerRef = instance.ContainerName
		}
		if containerRef != "" && instance.SSHAssetID != "" && s.sshPool != nil {
			if client, err := s.sshPool.GetSSHClient(instance.SSHAssetID); err == nil {
				s.stopContainerRemote(containerRef, client)
			}
		}
	}

	instance.mu.Lock()
	instance.Status = BrowserStatusClosed
	instance.mu.Unlock()

	// Update database
	now := time.Now()
	s.updateInstanceInDB(browserID, map[string]interface{}{
		"status":    models.BrowserInstanceStatusClosed,
		"closed_at": now,
	})

	s.notifyStateChange(browserID, instance)
	s.logger.Info("Browser closed", "browserID", browserID, "runtimeType", instance.RuntimeType)

	return nil
}

// CloseConversationBrowsers closes all browsers for a conversation
func (s *BrowserService) CloseConversationBrowsers(conversationID string) {
	s.mu.RLock()
	browserIDs := make([]string, len(s.byConv[conversationID]))
	copy(browserIDs, s.byConv[conversationID])
	s.mu.RUnlock()

	for _, browserID := range browserIDs {
		if err := s.CloseBrowser(browserID); err != nil {
			s.logger.Warn("Failed to close browser", "browserID", browserID, "error", err)
		}
	}
}

// UpdateActivity updates the last activity time for a browser
func (s *BrowserService) UpdateActivity(browserID string) {
	s.mu.RLock()
	instance, ok := s.browsers[browserID]
	s.mu.RUnlock()

	if ok {
		now := time.Now()
		instance.mu.Lock()
		instance.LastActivityAt = now
		instance.mu.Unlock()

		// Update in database
		s.updateInstanceInDB(browserID, map[string]interface{}{
			"last_activity_at": now,
		})
	}
}

// cleanupLoop periodically checks for idle browsers
func (s *BrowserService) cleanupLoop() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-s.stopCleanup:
			return
		case <-ticker.C:
			s.cleanupIdleBrowsers()
		}
	}
}

// cleanupIdleBrowsers closes browsers that have been idle too long
func (s *BrowserService) cleanupIdleBrowsers() {
	now := time.Now()

	// 1. Check in-memory browsers
	// First, collect all browser IDs and instances
	s.mu.RLock()
	browserList := make([]*BrowserInstance, 0, len(s.browsers))
	browserIDs := make([]string, 0, len(s.browsers))
	for browserID, instance := range s.browsers {
		browserList = append(browserList, instance)
		browserIDs = append(browserIDs, browserID)
	}
	s.mu.RUnlock()

	// Now check each instance without holding the service lock
	var toClose []string
	for i, instance := range browserList {
		instance.mu.Lock()
		idle := now.Sub(instance.LastActivityAt)
		status := instance.Status
		instance.mu.Unlock()

		if status != BrowserStatusClosed && idle > s.idleTimeout {
			toClose = append(toClose, browserIDs[i])
			s.logger.Info("Browser idle timeout", "browserID", browserIDs[i], "idle", idle)
		}
	}

	for _, browserID := range toClose {
		s.CloseBrowser(browserID)
	}

	// 2. Check database for non-closed instances that are not in memory (orphaned records)
	if s.db != nil {
		var records []models.BrowserInstanceRecord
		s.db.Where("status != ?", models.BrowserInstanceStatusClosed).Find(&records)

		for _, record := range records {
			// Skip if already in memory (handled above)
			s.mu.RLock()
			_, inMemory := s.browsers[record.ID]
			s.mu.RUnlock()

			if inMemory {
				continue
			}

			// Check if timed out
			idle := now.Sub(record.LastActivityAt)
			if idle > s.idleTimeout {
				s.logger.Info("Marking orphaned browser record as closed", "browserID", record.ID, "idle", idle)

				// Mark as closed in database
				s.db.Model(&models.BrowserInstanceRecord{}).Where("id = ?", record.ID).Updates(map[string]interface{}{
					"status":    models.BrowserInstanceStatusClosed,
					"closed_at": now,
				})

				// Try to stop container
				go s.tryStopContainer(record)
			}
		}
	}
}

// Close shuts down the browser service
func (s *BrowserService) Close() {
	close(s.stopCleanup)

	s.mu.RLock()
	browserIDs := make([]string, 0, len(s.browsers))
	for id := range s.browsers {
		browserIDs = append(browserIDs, id)
	}
	s.mu.RUnlock()

	for _, id := range browserIDs {
		s.CloseBrowser(id)
	}
}

// ---- Browser Actions ----

// Navigate navigates to a URL
func (s *BrowserService) Navigate(ctx context.Context, browserID, targetURL string) error {
	instance, err := s.GetBrowser(browserID)
	if err != nil {
		return err
	}

	instance.mu.Lock()
	if instance.Status != BrowserStatusReady {
		instance.mu.Unlock()
		return fmt.Errorf("browser not ready, status: %s", instance.Status)
	}
	instance.Status = BrowserStatusBusy
	instance.mu.Unlock()

	defer func() {
		now := time.Now()
		instance.mu.Lock()
		instance.Status = BrowserStatusReady
		instance.LastActivityAt = now
		instance.mu.Unlock()
		s.updateInstanceInDB(browserID, map[string]interface{}{
			"last_activity_at": now,
		})
		s.notifyStateChange(browserID, instance)
	}()

	err = chromedp.Run(instance.ctx,
		chromedp.Navigate(targetURL),
		chromedp.WaitReady("body"),
	)
	if err != nil {
		return fmt.Errorf("navigation failed: %w", err)
	}

	// Update current URL and title
	var title string
	chromedp.Run(instance.ctx, chromedp.Title(&title))

	instance.mu.Lock()
	instance.CurrentURL = targetURL
	instance.CurrentTitle = title
	if len(instance.Tabs) > instance.ActiveTab {
		instance.Tabs[instance.ActiveTab].URL = targetURL
		instance.Tabs[instance.ActiveTab].Title = title
	}
	instance.mu.Unlock()

	// Save updated state to database
	s.saveInstanceToDB(instance)

	return nil
}

// Click clicks an element by selector
func (s *BrowserService) Click(ctx context.Context, browserID, selector string) error {
	instance, err := s.GetBrowser(browserID)
	if err != nil {
		return err
	}

	instance.mu.Lock()
	if instance.Status != BrowserStatusReady {
		instance.mu.Unlock()
		return fmt.Errorf("browser not ready")
	}
	instance.Status = BrowserStatusBusy
	instance.mu.Unlock()

	defer func() {
		now := time.Now()
		instance.mu.Lock()
		instance.Status = BrowserStatusReady
		instance.LastActivityAt = now
		instance.mu.Unlock()
		s.updateInstanceInDB(browserID, map[string]interface{}{
			"last_activity_at": now,
		})
	}()

	err = chromedp.Run(instance.ctx,
		chromedp.WaitVisible(selector),
		chromedp.Click(selector),
	)
	if err != nil {
		return fmt.Errorf("click failed: %w", err)
	}

	return nil
}

// InputText types text into an element
func (s *BrowserService) InputText(ctx context.Context, browserID, selector, text string, clear bool) error {
	instance, err := s.GetBrowser(browserID)
	if err != nil {
		return err
	}

	instance.mu.Lock()
	if instance.Status != BrowserStatusReady {
		instance.mu.Unlock()
		return fmt.Errorf("browser not ready")
	}
	instance.Status = BrowserStatusBusy
	instance.mu.Unlock()

	defer func() {
		now := time.Now()
		instance.mu.Lock()
		instance.Status = BrowserStatusReady
		instance.LastActivityAt = now
		instance.mu.Unlock()
		s.updateInstanceInDB(browserID, map[string]interface{}{
			"last_activity_at": now,
		})
	}()

	actions := []chromedp.Action{
		chromedp.WaitVisible(selector),
	}

	if clear {
		actions = append(actions, chromedp.Clear(selector))
	}
	actions = append(actions, chromedp.SendKeys(selector, text))

	err = chromedp.Run(instance.ctx, actions...)
	if err != nil {
		return fmt.Errorf("input failed: %w", err)
	}

	return nil
}

// Scroll scrolls the page
func (s *BrowserService) Scroll(ctx context.Context, browserID string, direction string, amount int) error {
	instance, err := s.GetBrowser(browserID)
	if err != nil {
		return err
	}

	instance.mu.Lock()
	if instance.Status != BrowserStatusReady {
		instance.mu.Unlock()
		return fmt.Errorf("browser not ready")
	}
	instance.Status = BrowserStatusBusy
	instance.mu.Unlock()

	defer func() {
		now := time.Now()
		instance.mu.Lock()
		instance.Status = BrowserStatusReady
		instance.LastActivityAt = now
		instance.mu.Unlock()
		s.updateInstanceInDB(browserID, map[string]interface{}{
			"last_activity_at": now,
		})
	}()

	scrollY := amount
	if direction == "up" {
		scrollY = -amount
	}

	script := fmt.Sprintf("window.scrollBy(0, %d)", scrollY)
	err = chromedp.Run(instance.ctx, chromedp.Evaluate(script, nil))
	if err != nil {
		return fmt.Errorf("scroll failed: %w", err)
	}

	return nil
}

// Screenshot takes a screenshot of the current page
func (s *BrowserService) Screenshot(ctx context.Context, browserID string, fullPage bool) ([]byte, error) {
	instance, err := s.GetBrowser(browserID)
	if err != nil {
		return nil, err
	}

	instance.mu.Lock()
	if instance.Status != BrowserStatusReady && instance.Status != BrowserStatusBusy {
		instance.mu.Unlock()
		return nil, fmt.Errorf("browser not ready")
	}
	instance.mu.Unlock()

	var buf []byte
	var action chromedp.Action
	if fullPage {
		action = chromedp.FullScreenshot(&buf, 90)
	} else {
		action = chromedp.CaptureScreenshot(&buf)
	}

	err = chromedp.Run(instance.ctx, action)
	if err != nil {
		return nil, fmt.Errorf("screenshot failed: %w", err)
	}

	now := time.Now()
	instance.mu.Lock()
	instance.LastActivityAt = now
	instance.mu.Unlock()
	s.updateInstanceInDB(browserID, map[string]interface{}{
		"last_activity_at": now,
	})

	return buf, nil
}

// ExtractContent extracts content from the page
func (s *BrowserService) ExtractContent(ctx context.Context, browserID string, selector string, contentType string) (string, error) {
	instance, err := s.GetBrowser(browserID)
	if err != nil {
		return "", err
	}

	instance.mu.Lock()
	if instance.Status != BrowserStatusReady {
		instance.mu.Unlock()
		return "", fmt.Errorf("browser not ready")
	}
	instance.Status = BrowserStatusBusy
	instance.mu.Unlock()

	defer func() {
		now := time.Now()
		instance.mu.Lock()
		instance.Status = BrowserStatusReady
		instance.LastActivityAt = now
		instance.mu.Unlock()
		s.updateInstanceInDB(browserID, map[string]interface{}{
			"last_activity_at": now,
		})
	}()

	var content string
	var action chromedp.Action

	if selector == "" {
		selector = "body"
	}

	switch contentType {
	case "html":
		action = chromedp.OuterHTML(selector, &content)
	case "text":
		action = chromedp.Text(selector, &content)
	default:
		action = chromedp.Text(selector, &content)
	}

	err = chromedp.Run(instance.ctx,
		chromedp.WaitReady(selector),
		action,
	)
	if err != nil {
		return "", fmt.Errorf("extract failed: %w", err)
	}

	return content, nil
}

// Wait waits for a specified duration or element
func (s *BrowserService) Wait(ctx context.Context, browserID string, selector string, timeout time.Duration) error {
	instance, err := s.GetBrowser(browserID)
	if err != nil {
		return err
	}

	instance.mu.Lock()
	if instance.Status != BrowserStatusReady {
		instance.mu.Unlock()
		return fmt.Errorf("browser not ready")
	}
	instance.Status = BrowserStatusBusy
	instance.mu.Unlock()

	defer func() {
		now := time.Now()
		instance.mu.Lock()
		instance.Status = BrowserStatusReady
		instance.LastActivityAt = now
		instance.mu.Unlock()
		s.updateInstanceInDB(browserID, map[string]interface{}{
			"last_activity_at": now,
		})
	}()

	if selector != "" {
		// Wait for element
		waitCtx, cancel := context.WithTimeout(instance.ctx, timeout)
		defer cancel()
		err = chromedp.Run(waitCtx, chromedp.WaitVisible(selector))
	} else {
		// Simple sleep
		time.Sleep(timeout)
	}

	return err
}

// OpenTab opens a new tab
func (s *BrowserService) OpenTab(ctx context.Context, browserID string, targetURL string) error {
	instance, err := s.GetBrowser(browserID)
	if err != nil {
		return err
	}

	instance.mu.Lock()
	if instance.Status != BrowserStatusReady {
		instance.mu.Unlock()
		return fmt.Errorf("browser not ready")
	}
	instance.Status = BrowserStatusBusy
	instance.mu.Unlock()

	defer func() {
		now := time.Now()
		instance.mu.Lock()
		instance.Status = BrowserStatusReady
		instance.LastActivityAt = now
		instance.mu.Unlock()
		s.updateInstanceInDB(browserID, map[string]interface{}{
			"last_activity_at": now,
		})
		s.notifyStateChange(browserID, instance)
	}()

	if targetURL == "" {
		targetURL = "about:blank"
	}

	// Create a new tab (new chromedp context on the same allocator)
	tabCtx, tabCancel := chromedp.NewContext(instance.allocCtx)

	// Set viewport and navigate
	err = chromedp.Run(tabCtx,
		chromedp.EmulateViewport(int64(BrowserWindowWidth), int64(BrowserWindowHeight)),
		chromedp.Navigate(targetURL),
		chromedp.WaitReady("body"),
	)
	if err != nil {
		tabCancel()
		return fmt.Errorf("open tab failed: %w", err)
	}

	// Get page title
	var title string
	chromedp.Run(tabCtx, chromedp.Title(&title))
	if title == "" {
		title = "New Tab"
	}

	// Add new tab to list
	instance.mu.Lock()
	newTabID := fmt.Sprintf("tab-%d", len(instance.Tabs))
	newTab := BrowserTab{
		ID:     newTabID,
		URL:    targetURL,
		Title:  title,
		ctx:    tabCtx,
		cancel: tabCancel,
	}
	instance.Tabs = append(instance.Tabs, newTab)
	instance.ActiveTab = len(instance.Tabs) - 1
	instance.ctx = tabCtx // Switch to new tab's context
	instance.cancel = tabCancel
	instance.CurrentURL = targetURL
	instance.CurrentTitle = title
	instance.mu.Unlock()

	// Save updated state to database
	s.saveInstanceToDB(instance)

	s.logger.Info("Opened new tab", "browserID", browserID, "tabID", newTabID, "url", targetURL)
	return nil
}

// SwitchTab switches to a different tab
func (s *BrowserService) SwitchTab(ctx context.Context, browserID string, tabIndex int) error {
	instance, err := s.GetBrowser(browserID)
	if err != nil {
		return err
	}

	instance.mu.Lock()

	if tabIndex < 0 || tabIndex >= len(instance.Tabs) {
		instance.mu.Unlock()
		return fmt.Errorf("invalid tab index: %d (have %d tabs)", tabIndex, len(instance.Tabs))
	}

	// Switch to the tab's context
	tab := &instance.Tabs[tabIndex]
	if tab.ctx == nil {
		instance.mu.Unlock()
		return fmt.Errorf("tab %d has no context", tabIndex)
	}

	now := time.Now()
	instance.ActiveTab = tabIndex
	instance.ctx = tab.ctx
	instance.cancel = tab.cancel
	instance.CurrentURL = tab.URL
	instance.CurrentTitle = tab.Title
	instance.LastActivityAt = now
	instance.mu.Unlock()

	// Save to database
	s.saveInstanceToDB(instance)

	s.logger.Info("Switched tab", "browserID", browserID, "tabIndex", tabIndex)
	return nil
}

// CloseTab closes a tab
func (s *BrowserService) CloseTab(ctx context.Context, browserID string, tabIndex int) error {
	instance, err := s.GetBrowser(browserID)
	if err != nil {
		return err
	}

	instance.mu.Lock()

	if tabIndex < 0 || tabIndex >= len(instance.Tabs) {
		instance.mu.Unlock()
		return fmt.Errorf("invalid tab index: %d", tabIndex)
	}

	if len(instance.Tabs) <= 1 {
		instance.mu.Unlock()
		return fmt.Errorf("cannot close the last tab, use browser_close to close the browser")
	}

	// Cancel the tab's context
	tab := instance.Tabs[tabIndex]
	if tab.cancel != nil {
		tab.cancel()
	}

	// Remove tab from list
	instance.Tabs = append(instance.Tabs[:tabIndex], instance.Tabs[tabIndex+1:]...)

	// Adjust active tab if needed
	if instance.ActiveTab >= len(instance.Tabs) {
		instance.ActiveTab = len(instance.Tabs) - 1
	}
	if instance.ActiveTab == tabIndex && instance.ActiveTab > 0 {
		instance.ActiveTab--
	}

	// Switch to the new active tab's context
	if instance.ActiveTab >= 0 && instance.ActiveTab < len(instance.Tabs) {
		activeTab := &instance.Tabs[instance.ActiveTab]
		instance.ctx = activeTab.ctx
		instance.cancel = activeTab.cancel
		instance.CurrentURL = activeTab.URL
		instance.CurrentTitle = activeTab.Title
	}

	instance.LastActivityAt = time.Now()

	// Need to release lock before calling saveInstanceToDB (which also locks)
	instance.mu.Unlock()

	// Save to database
	s.saveInstanceToDB(instance)

	s.logger.Info("Closed tab", "browserID", browserID, "tabIndex", tabIndex)
	return nil
}

// WebSearch performs a web search
func (s *BrowserService) WebSearch(ctx context.Context, browserID string, query string, engine string) error {
	encodedQuery := url.QueryEscape(query)
	var searchURL string
	switch engine {
	case "bing":
		searchURL = fmt.Sprintf("https://www.bing.com/search?q=%s", encodedQuery)
	case "duckduckgo":
		searchURL = fmt.Sprintf("https://duckduckgo.com/?q=%s", encodedQuery)
	default: // google
		searchURL = fmt.Sprintf("https://www.google.com/search?q=%s", encodedQuery)
	}

	return s.Navigate(ctx, browserID, searchURL)
}

// GetScrollInfo returns the current scroll state of the page
func (s *BrowserService) GetScrollInfo(ctx context.Context, browserID string) (*ScrollInfo, error) {
	instance, err := s.GetBrowser(browserID)
	if err != nil {
		return nil, err
	}

	instance.mu.Lock()
	if instance.Status != BrowserStatusReady && instance.Status != BrowserStatusBusy {
		instance.mu.Unlock()
		return nil, fmt.Errorf("browser not ready")
	}
	instance.mu.Unlock()

	// JavaScript to get all scroll information
	script := `
		(function() {
			var doc = document.documentElement;
			var body = document.body;
			var scrollX = window.pageXOffset || doc.scrollLeft || body.scrollLeft || 0;
			var scrollY = window.pageYOffset || doc.scrollTop || body.scrollTop || 0;
			var scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth, doc.offsetWidth, body.offsetWidth, doc.clientWidth);
			var scrollHeight = Math.max(doc.scrollHeight, body.scrollHeight, doc.offsetHeight, body.offsetHeight, doc.clientHeight);
			var clientWidth = doc.clientWidth || body.clientWidth || window.innerWidth;
			var clientHeight = doc.clientHeight || body.clientHeight || window.innerHeight;
			
			var maxScrollX = scrollWidth - clientWidth;
			var maxScrollY = scrollHeight - clientHeight;
			
			return {
				scrollX: Math.round(scrollX),
				scrollY: Math.round(scrollY),
				scrollWidth: scrollWidth,
				scrollHeight: scrollHeight,
				clientWidth: clientWidth,
				clientHeight: clientHeight,
				hasScrollbarX: scrollWidth > clientWidth,
				hasScrollbarY: scrollHeight > clientHeight,
				atTop: scrollY <= 0,
				atBottom: maxScrollY <= 0 || scrollY >= maxScrollY - 1,
				atLeft: scrollX <= 0,
				atRight: maxScrollX <= 0 || scrollX >= maxScrollX - 1,
				percentX: maxScrollX > 0 ? Math.round((scrollX / maxScrollX) * 100) : 0,
				percentY: maxScrollY > 0 ? Math.round((scrollY / maxScrollY) * 100) : 0
			};
		})()
	`

	var result map[string]interface{}
	err = chromedp.Run(instance.ctx, chromedp.Evaluate(script, &result))
	if err != nil {
		return nil, fmt.Errorf("failed to get scroll info: %w", err)
	}

	// Parse the result
	info := &ScrollInfo{
		ScrollX:       int(result["scrollX"].(float64)),
		ScrollY:       int(result["scrollY"].(float64)),
		ScrollWidth:   int(result["scrollWidth"].(float64)),
		ScrollHeight:  int(result["scrollHeight"].(float64)),
		ClientWidth:   int(result["clientWidth"].(float64)),
		ClientHeight:  int(result["clientHeight"].(float64)),
		HasScrollbarX: result["hasScrollbarX"].(bool),
		HasScrollbarY: result["hasScrollbarY"].(bool),
		AtTop:         result["atTop"].(bool),
		AtBottom:      result["atBottom"].(bool),
		AtLeft:        result["atLeft"].(bool),
		AtRight:       result["atRight"].(bool),
		PercentX:      int(result["percentX"].(float64)),
		PercentY:      int(result["percentY"].(float64)),
	}

	now := time.Now()
	instance.mu.Lock()
	instance.LastActivityAt = now
	instance.mu.Unlock()
	s.updateInstanceInDB(browserID, map[string]interface{}{
		"last_activity_at": now,
	})

	return info, nil
}
