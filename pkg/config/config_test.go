package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoad_MissingFile_ReturnsDefault(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	cfg, path, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if path == "" {
		t.Fatalf("expected config path")
	}
	if got := cfg.Host(); got != DefaultHost {
		t.Fatalf("cfg.Host() = %q, want %q", got, DefaultHost)
	}
	if got := cfg.Port(); got != DefaultPort {
		t.Fatalf("cfg.Port() = %d, want %d", got, DefaultPort)
	}
}

func TestEnsureDefaultConfig_CreatesFile(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	path, err := EnsureDefaultConfig()
	if err != nil {
		t.Fatalf("EnsureDefaultConfig() error = %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected config file to exist at %s: %v", path, err)
	}

	cfg, gotPath, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if filepath.Clean(gotPath) != filepath.Clean(path) {
		t.Fatalf("Load() path = %s, want %s", gotPath, path)
	}
	if got := cfg.Host(); got != DefaultHost {
		t.Fatalf("cfg.Host() = %q, want %q", got, DefaultHost)
	}
	if got := cfg.Port(); got != DefaultPort {
		t.Fatalf("cfg.Port() = %d, want %d", got, DefaultPort)
	}
}

func TestLoad_ParsesHostAndPort(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	configDir := filepath.Join(home, ".choraleia")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		t.Fatalf("mkdir config dir: %v", err)
	}
	configPath := filepath.Join(configDir, "config.yaml")

	if err := os.WriteFile(configPath, []byte("server:\n  host: 0.0.0.0\n  port: 9090\n"), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, _, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if got := cfg.Host(); got != "0.0.0.0" {
		t.Fatalf("cfg.Host() = %q, want %q", got, "0.0.0.0")
	}
	if got := cfg.Port(); got != 9090 {
		t.Fatalf("cfg.Port() = %d, want %d", got, 9090)
	}
}

func TestLoad_ParsesPort(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	configDir := filepath.Join(home, ".choraleia")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		t.Fatalf("mkdir config dir: %v", err)
	}
	configPath := filepath.Join(configDir, "config.yaml")

	if err := os.WriteFile(configPath, []byte("server:\n  port: 9090\n"), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, _, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if got := cfg.Port(); got != 9090 {
		t.Fatalf("cfg.Port() = %d, want %d", got, 9090)
	}
}
