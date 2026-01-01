package models

import (
	"embed"
	"encoding/json"
	"os"
	"path/filepath"
)

//go:embed presets.json
var presetsFS embed.FS

const presetsFileName = ".choraleia/model_providers.json"

// ModelPreset represents a predefined model configuration
type ModelPreset struct {
	Model        string             `json:"model"`
	Name         string             `json:"name"`
	Domain       string             `json:"domain"`                 // High-level category
	TaskTypes    []string           `json:"task_types"`             // Specific tasks supported
	Capabilities *ModelCapabilities `json:"capabilities,omitempty"` // Functional features
	Limits       *ModelLimits       `json:"limits,omitempty"`       // Size limits
	Description  string             `json:"description,omitempty"`
}

// ProviderPreset represents a provider with its predefined models
type ProviderPreset struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	BaseURL     string        `json:"base_url"`
	Presets     []ModelPreset `json:"presets"`
	ExtraFields []ExtraField  `json:"extra_fields,omitempty"`
}

// ExtraField defines additional fields required by a provider
type ExtraField struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Required    bool   `json:"required"`
	Placeholder string `json:"placeholder,omitempty"`
}

// PresetsConfig holds all provider presets
type PresetsConfig struct {
	Providers []ProviderPreset `json:"providers"`
}

// getPresetsFilePath returns the full path to user's presets file
func getPresetsFilePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return presetsFileName
	}
	return filepath.Join(home, presetsFileName)
}

// loadEmbeddedPresets reads presets from embedded JSON file
func loadEmbeddedPresets() (*PresetsConfig, error) {
	data, err := presetsFS.ReadFile("presets.json")
	if err != nil {
		return nil, err
	}
	var config PresetsConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}
	return &config, nil
}

// LoadPresets reads presets from user's home directory file first,
// if not exists, creates it from embedded presets.json
func LoadPresets() (*PresetsConfig, error) {
	path := getPresetsFilePath()

	// Try to read from user's home directory
	if data, err := os.ReadFile(path); err == nil {
		var config PresetsConfig
		if err := json.Unmarshal(data, &config); err == nil {
			return &config, nil
		}
		// If parse fails, fall through to recreate from embedded
	}

	// Load from embedded presets.json
	config, err := loadEmbeddedPresets()
	if err != nil {
		return nil, err
	}

	// Create the user's presets file
	if err := SavePresets(config); err != nil {
		// Log error but don't fail - return the embedded config
		// The file will be created on next successful save
	}

	return config, nil
}

// SavePresets saves the presets config to user's home directory
func SavePresets(config *PresetsConfig) error {
	path := getPresetsFilePath()

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0600)
}
