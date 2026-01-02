package fs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// SSHPool manages SSH connections for SSH assets.
// It provides both raw SSH clients (for remote command execution)
// and SFTP clients (for file operations).
// Connections are automatically checked for health and cleaned up if dead.
type SSHPool struct {
	assets AssetResolver

	mu      sync.Mutex
	clients map[string]*sshClientEntry

	// Cleanup management
	stopCleanup chan struct{}
	cleanupOnce sync.Once
}

type sshClientEntry struct {
	ssh       *ssh.Client
	sftp      *sftp.Client // lazily created
	lastUsed  time.Time
	createdAt time.Time
}

// AssetResolver resolves an asset by ID. Implemented by service.AssetService.
type AssetResolver interface {
	GetAsset(id string) (*models.Asset, error)
}

func NewSSHPool(assets AssetResolver) *SSHPool {
	pool := &SSHPool{
		assets:      assets,
		clients:     make(map[string]*sshClientEntry),
		stopCleanup: make(chan struct{}),
	}
	// Start background cleanup goroutine
	go pool.cleanupLoop()
	return pool
}

// cleanupLoop periodically checks and removes dead connections
func (p *SSHPool) cleanupLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			p.cleanupDeadConnections()
		case <-p.stopCleanup:
			return
		}
	}
}

// cleanupDeadConnections removes connections that are dead or idle too long
func (p *SSHPool) cleanupDeadConnections() {
	p.mu.Lock()
	defer p.mu.Unlock()

	now := time.Now()
	maxIdleTime := 10 * time.Minute

	for key, entry := range p.clients {
		// Check if connection is dead
		if !p.isConnectionAlive(entry.ssh) {
			p.closeEntry(entry)
			delete(p.clients, key)
			continue
		}

		// Check if connection has been idle too long
		if now.Sub(entry.lastUsed) > maxIdleTime {
			p.closeEntry(entry)
			delete(p.clients, key)
		}
	}
}

// isConnectionAlive checks if SSH connection is still alive using a keepalive request
func (p *SSHPool) isConnectionAlive(client *ssh.Client) bool {
	if client == nil {
		return false
	}
	// Send a keepalive request with short timeout
	_, _, err := client.SendRequest("keepalive@openssh.com", true, nil)
	return err == nil
}

// closeEntry safely closes an entry's connections
func (p *SSHPool) closeEntry(entry *sshClientEntry) {
	if entry.sftp != nil {
		_ = entry.sftp.Close()
	}
	if entry.ssh != nil {
		_ = entry.ssh.Close()
	}
}

func (p *SSHPool) CloseAll() {
	// Stop cleanup goroutine
	p.cleanupOnce.Do(func() {
		close(p.stopCleanup)
	})

	p.mu.Lock()
	defer p.mu.Unlock()
	for k, entry := range p.clients {
		p.closeEntry(entry)
		delete(p.clients, k)
	}
}

// GetSSHClient returns an SSH client for the given asset.
func (p *SSHPool) GetSSHClient(assetID string) (*ssh.Client, error) {
	key := cacheKey(assetID)

	p.mu.Lock()
	if cached, ok := p.clients[key]; ok {
		// Check if connection is still alive
		if p.isConnectionAlive(cached.ssh) {
			cached.lastUsed = time.Now()
			cli := cached.ssh
			p.mu.Unlock()
			return cli, nil
		}
		// Connection is dead, remove it
		p.closeEntry(cached)
		delete(p.clients, key)
	}
	p.mu.Unlock()

	asset, err := p.assets.GetAsset(assetID)
	if err != nil {
		return nil, err
	}
	if asset.Type != models.AssetTypeSSH {
		return nil, fmt.Errorf("asset is not ssh")
	}

	ctx := context.Background()
	sshClient, err := dialSSHFromAsset(ctx, asset)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	p.mu.Lock()
	p.clients[key] = &sshClientEntry{
		ssh:       sshClient,
		lastUsed:  now,
		createdAt: now,
	}
	p.mu.Unlock()

	return sshClient, nil
}

// GetSFTPClient returns an SFTP client for the given asset.
func (p *SSHPool) GetSFTPClient(ctx context.Context, assetID string) (*sftp.Client, error) {
	key := cacheKey(assetID)

	p.mu.Lock()
	if cached, ok := p.clients[key]; ok {
		// Check if connection is still alive
		if !p.isConnectionAlive(cached.ssh) {
			// Connection is dead, remove it
			p.closeEntry(cached)
			delete(p.clients, key)
			p.mu.Unlock()
			// Fall through to create new connection
		} else {
			cached.lastUsed = time.Now()
			if cached.sftp != nil {
				cli := cached.sftp
				p.mu.Unlock()
				return cli, nil
			}
			// SSH client exists but no SFTP client yet
			sftpCli, err := sftp.NewClient(cached.ssh)
			if err != nil {
				p.mu.Unlock()
				return nil, fmt.Errorf("create sftp client: %w", err)
			}
			cached.sftp = sftpCli
			p.mu.Unlock()
			return sftpCli, nil
		}
	} else {
		p.mu.Unlock()
	}

	asset, err := p.assets.GetAsset(assetID)
	if err != nil {
		return nil, err
	}
	if asset.Type != models.AssetTypeSSH {
		return nil, fmt.Errorf("asset is not ssh")
	}

	sshClient, err := dialSSHFromAsset(ctx, asset)
	if err != nil {
		return nil, err
	}

	sftpCli, err := sftp.NewClient(sshClient)
	if err != nil {
		_ = sshClient.Close()
		return nil, fmt.Errorf("create sftp client: %w", err)
	}

	now := time.Now()
	p.mu.Lock()
	p.clients[key] = &sshClientEntry{
		ssh:       sshClient,
		sftp:      sftpCli,
		lastUsed:  now,
		createdAt: now,
	}
	p.mu.Unlock()

	return sftpCli, nil
}

func cacheKey(assetID string) string {
	sum := sha256.Sum256([]byte(assetID))
	return hex.EncodeToString(sum[:])
}

func dialSSHFromAsset(ctx context.Context, asset *models.Asset) (*ssh.Client, error) {
	cfg := asset.Config

	host, _ := cfg["host"].(string)
	if host == "" {
		return nil, fmt.Errorf("ssh host not specified")
	}

	port := 22
	if portConfig, ok := cfg["port"].(float64); ok {
		port = int(portConfig)
	}

	username, _ := cfg["username"].(string)
	if username == "" {
		return nil, fmt.Errorf("ssh username not specified")
	}

	sshConfig := &ssh.ClientConfig{
		User:            username,
		Auth:            []ssh.AuthMethod{},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second,
	}

	if timeoutConfig, ok := cfg["timeout"].(float64); ok {
		sshConfig.Timeout = time.Duration(timeoutConfig) * time.Second
	}

	if password, ok := cfg["password"].(string); ok && password != "" {
		sshConfig.Auth = append(sshConfig.Auth, ssh.Password(password))
	}

	passphrase, _ := cfg["private_key_passphrase"].(string)

	if privateKeyPath, ok := cfg["private_key_path"].(string); ok && privateKeyPath != "" {
		key, err := loadPrivateKeyFromFile(privateKeyPath, passphrase)
		if err == nil {
			sshConfig.Auth = append(sshConfig.Auth, ssh.PublicKeys(key))
		}
	}
	if privateKey, ok := cfg["private_key"].(string); ok && privateKey != "" {
		key, err := parsePrivateKeyString(privateKey, passphrase)
		if err == nil {
			sshConfig.Auth = append(sshConfig.Auth, ssh.PublicKeys(key))
		}
	}

	if len(sshConfig.Auth) == 0 {
		sshConfig.Auth = append(sshConfig.Auth, ssh.Password(""))
	}

	addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))
	dialer := &net.Dialer{Timeout: sshConfig.Timeout}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("dial ssh tcp: %w", err)
	}

	c, chans, reqs, err := ssh.NewClientConn(conn, addr, sshConfig)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("ssh handshake: %w", err)
	}
	return ssh.NewClient(c, chans, reqs), nil
}

func loadPrivateKeyFromFile(path string, passphrase string) (ssh.Signer, error) {
	key, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return parsePrivateKeyString(string(key), passphrase)
}

func parsePrivateKeyString(keyData string, passphrase string) (ssh.Signer, error) {
	signer, err := ssh.ParsePrivateKey([]byte(keyData))
	if err == nil {
		return signer, nil
	}
	if passphrase == "" {
		return nil, err
	}
	return ssh.ParsePrivateKeyWithPassphrase([]byte(keyData), []byte(passphrase))
}

// normalizeRemotePath is shared between pool-backed SFTP filesystem calls.
func normalizeRemotePath(p string) (string, error) {
	p = strings.TrimSpace(p)
	if p == "" {
		return "/", nil
	}
	p = filepath.ToSlash(p)
	if !strings.HasPrefix(p, "/") {
		return "", fmt.Errorf("path must be absolute")
	}
	return p, nil
}
