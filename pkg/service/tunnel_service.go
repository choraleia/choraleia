// filepath: /home/blue/codes/choraleia/pkg/service/tunnel_service.go
package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
)

// TunnelStatus represents the current status of a tunnel
type TunnelStatus string

const (
	TunnelStatusRunning TunnelStatus = "running"
	TunnelStatusStopped TunnelStatus = "stopped"
	TunnelStatusError   TunnelStatus = "error"
)

// TunnelInfo represents runtime information about a tunnel
type TunnelInfo struct {
	ID            string       `json:"id"`
	AssetID       string       `json:"asset_id"`
	AssetName     string       `json:"asset_name"`
	Type          string       `json:"type"` // "local", "remote", "dynamic"
	LocalHost     string       `json:"local_host"`
	LocalPort     int          `json:"local_port"`
	RemoteHost    string       `json:"remote_host,omitempty"`
	RemotePort    int          `json:"remote_port,omitempty"`
	Status        TunnelStatus `json:"status"`
	ErrorMessage  string       `json:"error_message,omitempty"`
	BytesSent     int64        `json:"bytes_sent"`
	BytesReceived int64        `json:"bytes_received"`
	Connections   int32        `json:"connections"`
	StartedAt     *time.Time   `json:"started_at,omitempty"`
}

// TunnelStats represents aggregate statistics for all tunnels
type TunnelStats struct {
	Total              int   `json:"total"`
	Running            int   `json:"running"`
	Stopped            int   `json:"stopped"`
	Error              int   `json:"error"`
	TotalBytesSent     int64 `json:"total_bytes_sent"`
	TotalBytesReceived int64 `json:"total_bytes_received"`
}

// Tunnel represents an active SSH tunnel
type Tunnel struct {
	ID            string
	AssetID       string
	AssetName     string
	Config        models.SSHTunnel
	Status        TunnelStatus
	ErrorMessage  string
	BytesSent     int64
	BytesReceived int64
	Connections   int32
	StartedAt     *time.Time

	listener  net.Listener
	sshClient *ssh.Client
	ctx       context.Context
	cancel    context.CancelFunc
	mu        sync.RWMutex
}

// TunnelService manages SSH tunnels
type TunnelService struct {
	assetService *AssetService
	tunnels      map[string]*Tunnel
	mu           sync.RWMutex
}

// NewTunnelService creates a new tunnel service
func NewTunnelService(assetService *AssetService) *TunnelService {
	return &TunnelService{
		assetService: assetService,
		tunnels:      make(map[string]*Tunnel),
	}
}

// GetTunnels returns all registered tunnels with their current status
func (s *TunnelService) GetTunnels() ([]TunnelInfo, TunnelStats) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	tunnels := make([]TunnelInfo, 0, len(s.tunnels))
	stats := TunnelStats{}

	for _, t := range s.tunnels {
		t.mu.RLock()
		info := TunnelInfo{
			ID:            t.ID,
			AssetID:       t.AssetID,
			AssetName:     t.AssetName,
			Type:          t.Config.Type,
			LocalHost:     t.Config.LocalHost,
			LocalPort:     t.Config.LocalPort,
			RemoteHost:    t.Config.RemoteHost,
			RemotePort:    t.Config.RemotePort,
			Status:        t.Status,
			ErrorMessage:  t.ErrorMessage,
			BytesSent:     atomic.LoadInt64(&t.BytesSent),
			BytesReceived: atomic.LoadInt64(&t.BytesReceived),
			Connections:   atomic.LoadInt32(&t.Connections),
			StartedAt:     t.StartedAt,
		}
		t.mu.RUnlock()

		tunnels = append(tunnels, info)
		stats.Total++

		switch info.Status {
		case TunnelStatusRunning:
			stats.Running++
		case TunnelStatusStopped:
			stats.Stopped++
		case TunnelStatusError:
			stats.Error++
		}
		stats.TotalBytesSent += info.BytesSent
		stats.TotalBytesReceived += info.BytesReceived
	}

	return tunnels, stats
}

// GetStats returns only the tunnel statistics
func (s *TunnelService) GetStats() TunnelStats {
	_, stats := s.GetTunnels()
	return stats
}

// LoadTunnelsFromAssets loads all tunnel configurations from SSH assets
func (s *TunnelService) LoadTunnelsFromAssets() error {
	assets, err := s.assetService.ListAssets("", nil, "")
	if err != nil {
		return fmt.Errorf("failed to list assets: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// Clear existing tunnels that are stopped
	for id, t := range s.tunnels {
		if t.Status == TunnelStatusStopped {
			delete(s.tunnels, id)
		}
	}

	// Load tunnels from SSH assets
	for _, asset := range assets {
		if asset.Type != models.AssetTypeSSH {
			continue
		}

		sshConfig, err := parseSSHConfig(asset.Config)
		if err != nil {
			continue
		}

		for _, tunnelCfg := range sshConfig.Tunnels {
			// Check if tunnel already exists
			exists := false
			for _, t := range s.tunnels {
				if t.AssetID == asset.ID &&
					t.Config.Type == tunnelCfg.Type &&
					t.Config.LocalPort == tunnelCfg.LocalPort {
					exists = true
					break
				}
			}

			if !exists {
				localHost := tunnelCfg.LocalHost
				if localHost == "" {
					localHost = "127.0.0.1"
				}

				tunnel := &Tunnel{
					ID:        uuid.New().String(),
					AssetID:   asset.ID,
					AssetName: asset.Name,
					Config: models.SSHTunnel{
						Type:       tunnelCfg.Type,
						LocalHost:  localHost,
						LocalPort:  tunnelCfg.LocalPort,
						RemoteHost: tunnelCfg.RemoteHost,
						RemotePort: tunnelCfg.RemotePort,
					},
					Status: TunnelStatusStopped,
				}
				s.tunnels[tunnel.ID] = tunnel
			}
		}
	}

	return nil
}

// StartTunnel starts a specific tunnel by ID
func (s *TunnelService) StartTunnel(tunnelID string) error {
	s.mu.RLock()
	tunnel, exists := s.tunnels[tunnelID]
	s.mu.RUnlock()

	if !exists {
		return fmt.Errorf("tunnel not found: %s", tunnelID)
	}

	tunnel.mu.Lock()
	if tunnel.Status == TunnelStatusRunning {
		tunnel.mu.Unlock()
		return nil // Already running
	}
	tunnel.mu.Unlock()

	// Get SSH asset configuration
	asset, err := s.assetService.GetAsset(tunnel.AssetID)
	if err != nil {
		s.setTunnelError(tunnel, fmt.Sprintf("failed to get asset: %v", err))
		return err
	}

	sshConfig, err := parseSSHConfig(asset.Config)
	if err != nil {
		s.setTunnelError(tunnel, fmt.Sprintf("failed to parse SSH config: %v", err))
		return err
	}

	// Create SSH client
	sshClient, err := s.createSSHClient(sshConfig)
	if err != nil {
		s.setTunnelError(tunnel, fmt.Sprintf("SSH connection failed: %v", err))
		return err
	}

	// Create context for cancellation
	ctx, cancel := context.WithCancel(context.Background())

	tunnel.mu.Lock()
	tunnel.sshClient = sshClient
	tunnel.ctx = ctx
	tunnel.cancel = cancel
	tunnel.mu.Unlock()

	// Start the appropriate tunnel type
	switch tunnel.Config.Type {
	case "local":
		return s.startLocalForward(tunnel)
	case "remote":
		return s.startRemoteForward(tunnel)
	case "dynamic":
		return s.startDynamicForward(tunnel)
	default:
		s.setTunnelError(tunnel, fmt.Sprintf("unknown tunnel type: %s", tunnel.Config.Type))
		return fmt.Errorf("unknown tunnel type: %s", tunnel.Config.Type)
	}
}

// StopTunnel stops a specific tunnel by ID
func (s *TunnelService) StopTunnel(tunnelID string) error {
	s.mu.RLock()
	tunnel, exists := s.tunnels[tunnelID]
	s.mu.RUnlock()

	if !exists {
		return fmt.Errorf("tunnel not found: %s", tunnelID)
	}

	tunnel.mu.Lock()
	defer tunnel.mu.Unlock()

	if tunnel.Status != TunnelStatusRunning {
		return nil // Not running
	}

	// Cancel context to stop goroutines
	if tunnel.cancel != nil {
		tunnel.cancel()
	}

	// Close listener
	if tunnel.listener != nil {
		tunnel.listener.Close()
	}

	// Close SSH client
	if tunnel.sshClient != nil {
		tunnel.sshClient.Close()
	}

	tunnel.Status = TunnelStatusStopped
	tunnel.ErrorMessage = ""
	tunnel.StartedAt = nil

	return nil
}

// parseSSHConfig parses asset config map into SSHConfig struct
func parseSSHConfig(config map[string]interface{}) (*models.SSHConfig, error) {
	data, err := json.Marshal(config)
	if err != nil {
		return nil, err
	}
	var sshConfig models.SSHConfig
	if err := json.Unmarshal(data, &sshConfig); err != nil {
		return nil, err
	}
	return &sshConfig, nil
}

// createSSHClient creates an SSH client connection
func (s *TunnelService) createSSHClient(cfg *models.SSHConfig) (*ssh.Client, error) {
	// Build SSH config
	sshCfg := &ssh.ClientConfig{
		User:            cfg.Username,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // TODO: implement proper host key verification
		Timeout:         time.Duration(cfg.Timeout) * time.Second,
	}

	if sshCfg.Timeout == 0 {
		sshCfg.Timeout = 30 * time.Second
	}

	// Add authentication methods
	if cfg.Password != "" {
		sshCfg.Auth = append(sshCfg.Auth, ssh.Password(cfg.Password))
	}

	if cfg.PrivateKey != "" {
		var signer ssh.Signer
		var err error
		keyData := []byte(cfg.PrivateKey)
		if cfg.PrivateKeyPassphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(keyData, []byte(cfg.PrivateKeyPassphrase))
		} else {
			signer, err = ssh.ParsePrivateKey(keyData)
		}
		if err == nil {
			sshCfg.Auth = append(sshCfg.Auth, ssh.PublicKeys(signer))
		}
	}

	// Connect to SSH server
	port := cfg.Port
	if port == 0 {
		port = 22
	}
	addr := fmt.Sprintf("%s:%d", cfg.Host, port)

	return ssh.Dial("tcp", addr, sshCfg)
}

// startLocalForward starts a local port forward (-L)
func (s *TunnelService) startLocalForward(tunnel *Tunnel) error {
	addr := fmt.Sprintf("%s:%d", tunnel.Config.LocalHost, tunnel.Config.LocalPort)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		s.setTunnelError(tunnel, fmt.Sprintf("failed to listen on %s: %v", addr, err))
		return err
	}

	tunnel.mu.Lock()
	tunnel.listener = listener
	tunnel.Status = TunnelStatusRunning
	now := time.Now()
	tunnel.StartedAt = &now
	tunnel.ErrorMessage = ""
	tunnel.mu.Unlock()

	// Accept connections in goroutine
	go func() {
		for {
			select {
			case <-tunnel.ctx.Done():
				return
			default:
			}

			conn, err := listener.Accept()
			if err != nil {
				select {
				case <-tunnel.ctx.Done():
					return
				default:
					continue
				}
			}

			atomic.AddInt32(&tunnel.Connections, 1)

			go func(conn net.Conn) {
				defer func() {
					conn.Close()
					atomic.AddInt32(&tunnel.Connections, -1)
				}()

				remoteAddr := fmt.Sprintf("%s:%d", tunnel.Config.RemoteHost, tunnel.Config.RemotePort)

				tunnel.mu.RLock()
				sshClient := tunnel.sshClient
				tunnel.mu.RUnlock()

				if sshClient == nil {
					return
				}

				remoteConn, err := sshClient.Dial("tcp", remoteAddr)
				if err != nil {
					return
				}
				defer remoteConn.Close()

				s.proxyConnections(tunnel, conn, remoteConn)
			}(conn)
		}
	}()

	return nil
}

// startRemoteForward starts a remote port forward (-R)
func (s *TunnelService) startRemoteForward(tunnel *Tunnel) error {
	tunnel.mu.RLock()
	sshClient := tunnel.sshClient
	tunnel.mu.RUnlock()

	if sshClient == nil {
		return fmt.Errorf("SSH client not connected")
	}

	remoteAddr := fmt.Sprintf("%s:%d", tunnel.Config.RemoteHost, tunnel.Config.RemotePort)
	listener, err := sshClient.Listen("tcp", remoteAddr)
	if err != nil {
		s.setTunnelError(tunnel, fmt.Sprintf("failed to listen on remote %s: %v", remoteAddr, err))
		return err
	}

	tunnel.mu.Lock()
	tunnel.listener = listener
	tunnel.Status = TunnelStatusRunning
	now := time.Now()
	tunnel.StartedAt = &now
	tunnel.ErrorMessage = ""
	tunnel.mu.Unlock()

	// Accept connections in goroutine
	go func() {
		for {
			select {
			case <-tunnel.ctx.Done():
				return
			default:
			}

			remoteConn, err := listener.Accept()
			if err != nil {
				select {
				case <-tunnel.ctx.Done():
					return
				default:
					continue
				}
			}

			atomic.AddInt32(&tunnel.Connections, 1)

			go func(remoteConn net.Conn) {
				defer func() {
					remoteConn.Close()
					atomic.AddInt32(&tunnel.Connections, -1)
				}()

				localAddr := fmt.Sprintf("%s:%d", tunnel.Config.LocalHost, tunnel.Config.LocalPort)
				localConn, err := net.Dial("tcp", localAddr)
				if err != nil {
					return
				}
				defer localConn.Close()

				s.proxyConnections(tunnel, localConn, remoteConn)
			}(remoteConn)
		}
	}()

	return nil
}

// startDynamicForward starts a dynamic port forward / SOCKS proxy (-D)
func (s *TunnelService) startDynamicForward(tunnel *Tunnel) error {
	addr := fmt.Sprintf("%s:%d", tunnel.Config.LocalHost, tunnel.Config.LocalPort)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		s.setTunnelError(tunnel, fmt.Sprintf("failed to listen on %s: %v", addr, err))
		return err
	}

	tunnel.mu.Lock()
	tunnel.listener = listener
	tunnel.Status = TunnelStatusRunning
	now := time.Now()
	tunnel.StartedAt = &now
	tunnel.ErrorMessage = ""
	tunnel.mu.Unlock()

	// Accept connections in goroutine - simplified SOCKS5 implementation
	go func() {
		for {
			select {
			case <-tunnel.ctx.Done():
				return
			default:
			}

			conn, err := listener.Accept()
			if err != nil {
				select {
				case <-tunnel.ctx.Done():
					return
				default:
					continue
				}
			}

			atomic.AddInt32(&tunnel.Connections, 1)

			go func(conn net.Conn) {
				defer func() {
					conn.Close()
					atomic.AddInt32(&tunnel.Connections, -1)
				}()

				s.handleSOCKS5(tunnel, conn)
			}(conn)
		}
	}()

	return nil
}

// handleSOCKS5 handles a SOCKS5 connection
func (s *TunnelService) handleSOCKS5(tunnel *Tunnel, conn net.Conn) {
	// Simplified SOCKS5 implementation
	// Read version and methods
	buf := make([]byte, 256)
	n, err := conn.Read(buf)
	if err != nil || n < 2 {
		return
	}

	// Check SOCKS5 version
	if buf[0] != 0x05 {
		return
	}

	// Send no auth required
	conn.Write([]byte{0x05, 0x00})

	// Read connect request
	n, err = conn.Read(buf)
	if err != nil || n < 7 {
		return
	}

	// Parse request
	if buf[0] != 0x05 || buf[1] != 0x01 {
		conn.Write([]byte{0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0}) // Command not supported
		return
	}

	var targetAddr string
	var targetPort int

	switch buf[3] {
	case 0x01: // IPv4
		if n < 10 {
			return
		}
		targetAddr = fmt.Sprintf("%d.%d.%d.%d", buf[4], buf[5], buf[6], buf[7])
		targetPort = int(buf[8])<<8 | int(buf[9])
	case 0x03: // Domain
		addrLen := int(buf[4])
		if n < 5+addrLen+2 {
			return
		}
		targetAddr = string(buf[5 : 5+addrLen])
		targetPort = int(buf[5+addrLen])<<8 | int(buf[6+addrLen])
	case 0x04: // IPv6
		if n < 22 {
			return
		}
		targetAddr = fmt.Sprintf("[%x:%x:%x:%x:%x:%x:%x:%x]",
			uint16(buf[4])<<8|uint16(buf[5]),
			uint16(buf[6])<<8|uint16(buf[7]),
			uint16(buf[8])<<8|uint16(buf[9]),
			uint16(buf[10])<<8|uint16(buf[11]),
			uint16(buf[12])<<8|uint16(buf[13]),
			uint16(buf[14])<<8|uint16(buf[15]),
			uint16(buf[16])<<8|uint16(buf[17]),
			uint16(buf[18])<<8|uint16(buf[19]))
		targetPort = int(buf[20])<<8 | int(buf[21])
	default:
		conn.Write([]byte{0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0}) // Address type not supported
		return
	}

	// Connect through SSH
	tunnel.mu.RLock()
	sshClient := tunnel.sshClient
	tunnel.mu.RUnlock()

	if sshClient == nil {
		conn.Write([]byte{0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0}) // General failure
		return
	}

	remoteConn, err := sshClient.Dial("tcp", fmt.Sprintf("%s:%d", targetAddr, targetPort))
	if err != nil {
		conn.Write([]byte{0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0}) // Connection refused
		return
	}
	defer remoteConn.Close()

	// Send success response
	conn.Write([]byte{0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0})

	s.proxyConnections(tunnel, conn, remoteConn)
}

// proxyConnections proxies data between two connections
func (s *TunnelService) proxyConnections(tunnel *Tunnel, conn1, conn2 net.Conn) {
	var wg sync.WaitGroup
	wg.Add(2)

	// conn1 -> conn2
	go func() {
		defer wg.Done()
		n, _ := io.Copy(conn2, conn1)
		atomic.AddInt64(&tunnel.BytesSent, n)
	}()

	// conn2 -> conn1
	go func() {
		defer wg.Done()
		n, _ := io.Copy(conn1, conn2)
		atomic.AddInt64(&tunnel.BytesReceived, n)
	}()

	wg.Wait()
}

// setTunnelError sets the tunnel status to error with a message
func (s *TunnelService) setTunnelError(tunnel *Tunnel, msg string) {
	tunnel.mu.Lock()
	tunnel.Status = TunnelStatusError
	tunnel.ErrorMessage = msg
	tunnel.mu.Unlock()
}
