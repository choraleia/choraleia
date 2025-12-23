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

// SFTPPool manages SSH+SFTP connections for SSH assets.
//
// It lives in the fs layer so all SFTP-related logic is contained in pkg/service/fs.
// The service layer (FSRegistry) only passes an AssetResolver.
type SFTPPool struct {
	assets AssetResolver

	mu      sync.Mutex
	clients map[string]*sftpClient
}

type sftpClient struct {
	ssh  *ssh.Client
	sftp *sftp.Client
}

// AssetResolver resolves an asset by ID. Implemented by service.AssetService.
type AssetResolver interface {
	GetAsset(id string) (*models.Asset, error)
}

func NewSFTPPool(assets AssetResolver) *SFTPPool {
	return &SFTPPool{assets: assets, clients: make(map[string]*sftpClient)}
}

func (p *SFTPPool) CloseAll() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for k, c := range p.clients {
		_ = c.sftp.Close()
		_ = c.ssh.Close()
		delete(p.clients, k)
	}
}

func (p *SFTPPool) GetClient(ctx context.Context, assetID string) (*sftp.Client, error) {
	key := cacheKey(assetID)

	p.mu.Lock()
	if cached, ok := p.clients[key]; ok {
		cli := cached.sftp
		p.mu.Unlock()
		return cli, nil
	}
	p.mu.Unlock()

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

	p.mu.Lock()
	p.clients[key] = &sftpClient{ssh: sshClient, sftp: sftpCli}
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
