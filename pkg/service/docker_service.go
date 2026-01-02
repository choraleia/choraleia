package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"log/slog"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/utils"
	"golang.org/x/crypto/ssh"
)

// DockerService handles Docker host operations
type DockerService struct {
	assetService *AssetService
	logger       *slog.Logger
}

// DockerInfo contains Docker daemon information
type DockerInfo struct {
	Version        string `json:"version"`
	ContainerCount int    `json:"container_count"`
}

func NewDockerService(assetService *AssetService) *DockerService {
	return &DockerService{
		assetService: assetService,
		logger:       utils.GetLogger(),
	}
}

// ListContainers returns containers from a Docker host
func (s *DockerService) ListContainers(ctx context.Context, asset *models.Asset, showAll bool) ([]models.ContainerInfo, error) {
	var cfg models.DockerHostConfig
	if err := asset.GetTypedConfig(&cfg); err != nil {
		return nil, fmt.Errorf("invalid docker host config: %w", err)
	}

	// Build docker ps command with JSON format
	args := []string{"ps", "--format", "{{json .}}"}
	if showAll || cfg.ShowAllContainers {
		args = append(args, "-a")
	}

	var output string
	var err error

	if cfg.ConnectionType == "ssh" && cfg.SSHAssetID != "" {
		output, err = s.execViaSSH(ctx, cfg.SSHAssetID, "docker", args)
	} else {
		output, err = s.execLocal(ctx, "docker", args)
	}

	if err != nil {
		return nil, err
	}

	return s.parseContainerList(output)
}

// parseContainerList parses docker ps JSON output
func (s *DockerService) parseContainerList(output string) ([]models.ContainerInfo, error) {
	var containers []models.ContainerInfo
	lines := strings.Split(strings.TrimSpace(output), "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		var raw struct {
			ID      string `json:"ID"`
			Names   string `json:"Names"`
			Image   string `json:"Image"`
			State   string `json:"State"`
			Status  string `json:"Status"`
			Ports   string `json:"Ports"`
			Created string `json:"CreatedAt"`
		}

		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			s.logger.Warn("Failed to parse container JSON", "line", line, "error", err)
			continue
		}

		containers = append(containers, models.ContainerInfo{
			ID:      raw.ID,
			Name:    strings.TrimPrefix(raw.Names, "/"),
			Image:   raw.Image,
			State:   strings.ToLower(raw.State),
			Status:  raw.Status,
			Ports:   raw.Ports,
			Created: raw.Created,
		})
	}

	return containers, nil
}

// StartContainer starts a container
func (s *DockerService) StartContainer(ctx context.Context, asset *models.Asset, containerID string) error {
	return s.containerAction(ctx, asset, "start", containerID)
}

// StopContainer stops a container
func (s *DockerService) StopContainer(ctx context.Context, asset *models.Asset, containerID string) error {
	return s.containerAction(ctx, asset, "stop", containerID)
}

// RestartContainer restarts a container
func (s *DockerService) RestartContainer(ctx context.Context, asset *models.Asset, containerID string) error {
	return s.containerAction(ctx, asset, "restart", containerID)
}

// containerAction performs a docker container action
func (s *DockerService) containerAction(ctx context.Context, asset *models.Asset, action, containerID string) error {
	var cfg models.DockerHostConfig
	if err := asset.GetTypedConfig(&cfg); err != nil {
		return fmt.Errorf("invalid docker host config: %w", err)
	}

	args := []string{action, containerID}

	var err error
	if cfg.ConnectionType == "ssh" && cfg.SSHAssetID != "" {
		_, err = s.execViaSSH(ctx, cfg.SSHAssetID, "docker", args)
	} else {
		_, err = s.execLocal(ctx, "docker", args)
	}

	return err
}

// TestConnection tests the Docker daemon connection
func (s *DockerService) TestConnection(ctx context.Context, asset *models.Asset) (*DockerInfo, error) {
	var cfg models.DockerHostConfig
	if err := asset.GetTypedConfig(&cfg); err != nil {
		return nil, fmt.Errorf("invalid docker host config: %w", err)
	}

	// Get Docker version
	var versionOutput string
	var err error

	if cfg.ConnectionType == "ssh" && cfg.SSHAssetID != "" {
		versionOutput, err = s.execViaSSH(ctx, cfg.SSHAssetID, "docker", []string{"version", "--format", "{{.Server.Version}}"})
	} else {
		versionOutput, err = s.execLocal(ctx, "docker", []string{"version", "--format", "{{.Server.Version}}"})
	}

	if err != nil {
		return nil, fmt.Errorf("docker not available: %w", err)
	}

	// Get container count
	var countOutput string
	if cfg.ConnectionType == "ssh" && cfg.SSHAssetID != "" {
		countOutput, err = s.execViaSSH(ctx, cfg.SSHAssetID, "docker", []string{"ps", "-aq"})
	} else {
		countOutput, err = s.execLocal(ctx, "docker", []string{"ps", "-aq"})
	}

	containerCount := 0
	if err == nil {
		lines := strings.Split(strings.TrimSpace(countOutput), "\n")
		for _, l := range lines {
			if strings.TrimSpace(l) != "" {
				containerCount++
			}
		}
	}

	return &DockerInfo{
		Version:        strings.TrimSpace(versionOutput),
		ContainerCount: containerCount,
	}, nil
}

// execLocal executes a command locally
func (s *DockerService) execLocal(ctx context.Context, bin string, args []string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, bin, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		errMsg := strings.TrimSpace(stderr.String())
		if errMsg == "" {
			errMsg = err.Error()
		}
		return "", fmt.Errorf("%s", errMsg)
	}

	return stdout.String(), nil
}

// execViaSSH executes a command via SSH on a remote host
func (s *DockerService) execViaSSH(ctx context.Context, sshAssetID string, bin string, args []string) (string, error) {
	// Get SSH asset
	sshAsset, err := s.assetService.GetAsset(sshAssetID)
	if err != nil {
		return "", fmt.Errorf("SSH asset not found: %w", err)
	}

	if sshAsset.Type != models.AssetTypeSSH {
		return "", fmt.Errorf("referenced asset is not an SSH connection")
	}

	// Build SSH connection
	client, err := s.createSSHClient(sshAsset)
	if err != nil {
		return "", fmt.Errorf("SSH connection failed: %w", err)
	}
	defer client.Close()

	// Create session
	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("SSH session failed: %w", err)
	}
	defer session.Close()

	// Build command string
	cmdStr := bin
	for _, arg := range args {
		cmdStr += " " + shellQuote(arg)
	}

	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	if err := session.Run(cmdStr); err != nil {
		errMsg := strings.TrimSpace(stderr.String())
		if errMsg == "" {
			errMsg = err.Error()
		}
		return "", fmt.Errorf("%s", errMsg)
	}

	return stdout.String(), nil
}

// createSSHClient creates an SSH client from asset config
func (s *DockerService) createSSHClient(asset *models.Asset) (*ssh.Client, error) {
	config := asset.Config

	host, _ := config["host"].(string)
	if host == "" {
		return nil, fmt.Errorf("SSH host not specified")
	}

	port := 22
	if p, ok := config["port"].(float64); ok {
		port = int(p)
	}

	username, _ := config["username"].(string)
	if username == "" {
		return nil, fmt.Errorf("SSH username not specified")
	}

	sshConfig := &ssh.ClientConfig{
		User:            username,
		Auth:            []ssh.AuthMethod{},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second,
	}

	// Add password auth
	if password, ok := config["password"].(string); ok && password != "" {
		sshConfig.Auth = append(sshConfig.Auth, ssh.Password(password))
	}

	// Add key auth
	if privateKey, ok := config["private_key"].(string); ok && privateKey != "" {
		passphrase, _ := config["private_key_passphrase"].(string)
		if signer, err := parsePrivateKeyWithPassphrase(privateKey, passphrase); err == nil {
			sshConfig.Auth = append(sshConfig.Auth, ssh.PublicKeys(signer))
		}
	}

	if privateKeyPath, ok := config["private_key_path"].(string); ok && privateKeyPath != "" {
		passphrase, _ := config["private_key_passphrase"].(string)
		if signer, err := loadPrivateKeyFromPath(privateKeyPath, passphrase); err == nil {
			sshConfig.Auth = append(sshConfig.Auth, ssh.PublicKeys(signer))
		}
	}

	addr := fmt.Sprintf("%s:%d", host, port)
	return ssh.Dial("tcp", addr, sshConfig)
}

// shellQuote quotes a string for shell safety
func shellQuote(s string) string {
	if s == "" {
		return "''"
	}
	// Simple quoting: wrap in single quotes and escape existing single quotes
	return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'"
}

// parsePrivateKeyWithPassphrase parses a private key with optional passphrase
func parsePrivateKeyWithPassphrase(key, passphrase string) (ssh.Signer, error) {
	if passphrase != "" {
		return ssh.ParsePrivateKeyWithPassphrase([]byte(key), []byte(passphrase))
	}
	return ssh.ParsePrivateKey([]byte(key))
}

// loadPrivateKeyFromPath loads a private key from file path
func loadPrivateKeyFromPath(path, passphrase string) (ssh.Signer, error) {
	key, err := exec.Command("cat", path).Output()
	if err != nil {
		return nil, err
	}
	return parsePrivateKeyWithPassphrase(string(key), passphrase)
}
