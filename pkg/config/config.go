package config

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// AppConfig is read from a YAML file under the user's home directory.
// All fields are optional; defaults are applied by Load.
//
// Example (~/.choraleia/config.yaml):
//
// server:
//   host: 127.0.0.1
//   port: 8088
//
// Notes:
// - If the config file does not exist, Load returns defaults without error.
// - If the config file exists but cannot be parsed, Load returns an error.
// - Port must be between 1 and 65535.
//
// All code and comments must be in English.

type AppConfig struct {
	Server ServerConfig `yaml:"server"`
}

type ServerConfig struct {
	Host *string `yaml:"host"`
	Port *int    `yaml:"port"`
}

const (
	DefaultHost = "127.0.0.1"
	DefaultPort = 8088
)

// DefaultPaths returns the config dir and config file path.
func DefaultPaths() (configDir string, configFile string, err error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", fmt.Errorf("get user home dir: %w", err)
	}
	configDir = filepath.Join(home, ".choraleia")
	configFile = filepath.Join(configDir, "config.yaml")
	return configDir, configFile, nil
}

// Load reads ~/.choraleia/config.yaml.
// If the file doesn't exist, it returns a default config and nil error.
func Load() (*AppConfig, string, error) {
	_, configFile, err := DefaultPaths()
	if err != nil {
		return nil, "", err
	}

	cfg := &AppConfig{}
	// Default is applied via Port() helper.

	b, err := os.ReadFile(configFile)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return cfg, configFile, nil
		}
		return nil, "", fmt.Errorf("read config file %s: %w", configFile, err)
	}

	if err := yaml.Unmarshal(b, cfg); err != nil {
		return nil, "", fmt.Errorf("parse yaml config %s: %w", configFile, err)
	}

	// Validate
	host := cfg.Host()
	if strings.TrimSpace(host) == "" {
		return nil, "", fmt.Errorf("invalid server.host (empty) in %s", configFile)
	}

	port := cfg.Port()
	if port < 1 || port > 65535 {
		return nil, "", fmt.Errorf("invalid server.port %d in %s", port, configFile)
	}

	return cfg, configFile, nil
}

// EnsureDefaultConfig writes a default config file if it doesn't already exist.
// It is safe to call on startup.
func EnsureDefaultConfig() (string, error) {
	configDir, configFile, err := DefaultPaths()
	if err != nil {
		return "", err
	}

	if _, err := os.Stat(configFile); err == nil {
		return configFile, nil
	}

	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return "", fmt.Errorf("create config dir %s: %w", configDir, err)
	}

	defaultCfg := AppConfig{Server: ServerConfig{Host: ptr(DefaultHost), Port: ptr(DefaultPort)}}
	b, err := yaml.Marshal(&defaultCfg)
	if err != nil {
		return "", fmt.Errorf("marshal default config: %w", err)
	}

	// Write with restrictive permissions.
	if err := os.WriteFile(configFile, b, 0o600); err != nil {
		return "", fmt.Errorf("write default config file %s: %w", configFile, err)
	}

	return configFile, nil
}

func (c *AppConfig) Host() string {
	if c == nil {
		return DefaultHost
	}
	if c.Server.Host == nil {
		return DefaultHost
	}
	v := strings.TrimSpace(*c.Server.Host)
	if v == "" {
		return DefaultHost
	}
	return v
}

func (c *AppConfig) Port() int {
	if c == nil {
		return DefaultPort
	}
	if c.Server.Port == nil {
		return DefaultPort
	}
	return *c.Server.Port
}

func ptr[T any](v T) *T { return &v }
