package asset_exec

import (
	"fmt"
	"net"
	"os"
	"time"

	"golang.org/x/crypto/ssh"

	"github.com/choraleia/choraleia/pkg/models"
)

// connectSSH creates an SSH client connection
func connectSSH(config *models.SSHConfig) (*ssh.Client, error) {
	// Build auth methods
	var authMethods []ssh.AuthMethod

	// Password auth
	if config.Password != "" {
		authMethods = append(authMethods, ssh.Password(config.Password))
	}

	// Private key auth
	if config.PrivateKey != "" {
		var signer ssh.Signer
		var err error
		if config.PrivateKeyPassphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(config.PrivateKey), []byte(config.PrivateKeyPassphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(config.PrivateKey))
		}
		if err != nil {
			return nil, fmt.Errorf("failed to parse private key: %w", err)
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	}

	// Private key file
	if config.PrivateKeyPath != "" {
		keyData, err := os.ReadFile(config.PrivateKeyPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read private key file: %w", err)
		}
		var signer ssh.Signer
		if config.PrivateKeyPassphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(keyData, []byte(config.PrivateKeyPassphrase))
		} else {
			signer, err = ssh.ParsePrivateKey(keyData)
		}
		if err != nil {
			return nil, fmt.Errorf("failed to parse private key file: %w", err)
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	}

	if len(authMethods) == 0 {
		return nil, fmt.Errorf("no authentication method available")
	}

	// Build SSH config
	timeout := config.Timeout
	if timeout <= 0 {
		timeout = 30
	}

	sshConfig := &ssh.ClientConfig{
		User:            config.Username,
		Auth:            authMethods,
		Timeout:         time.Duration(timeout) * time.Second,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // TODO: implement proper host key verification
	}

	// Connect
	port := config.Port
	if port <= 0 {
		port = 22
	}

	addr := fmt.Sprintf("%s:%d", config.Host, port)
	client, err := ssh.Dial("tcp", addr, sshConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to dial %s: %w", addr, err)
	}

	return client, nil
}

// connectSSHWithProxy creates an SSH client connection through a proxy
func connectSSHWithProxy(config *models.SSHConfig) (*ssh.Client, error) {
	// For now, fallback to direct connection
	// TODO: implement SOCKS5/HTTP proxy support
	return connectSSH(config)
}

// dialWithProxy creates a net.Conn through a proxy
func dialWithProxy(proxyType, proxyAddr, targetAddr string, proxyAuth *proxyAuthInfo) (net.Conn, error) {
	// Placeholder for proxy dialing
	// TODO: implement SOCKS4/SOCKS5/HTTP proxy support
	return net.Dial("tcp", targetAddr)
}

type proxyAuthInfo struct {
	Username string
	Password string
}
