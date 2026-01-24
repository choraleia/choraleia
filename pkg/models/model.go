package models

import (
	"encoding/json"
	"os"
	"path/filepath"
)

const modelFileName = ".choraleia/models.json"

// ============================================================
// Domain Constants - High-level model categories
// ============================================================

const (
	DomainLanguage   = "language"   // Text/language processing
	DomainEmbedding  = "embedding"  // Vector embeddings
	DomainVision     = "vision"     // Image processing
	DomainAudio      = "audio"      // Audio processing
	DomainVideo      = "video"      // Video processing
	DomainMultimodal = "multimodal" // Multi-modal processing
)

// SupportedDomains all valid domain values
var SupportedDomains = map[string]struct{}{
	DomainLanguage:   {},
	DomainEmbedding:  {},
	DomainVision:     {},
	DomainAudio:      {},
	DomainVideo:      {},
	DomainMultimodal: {},
}

// ============================================================
// Task Type Constants - Specific capabilities within domains
// ============================================================

const (
	// Language domain tasks
	TaskTypeChat = "chat" // Conversational text generation

	// Embedding domain tasks
	TaskTypeTextEmbedding = "text_embedding" // Text to vector

	// Vision domain tasks
	TaskTypeImageUnderstanding = "image_understanding" // Image to text
	TaskTypeImageGeneration    = "image_generation"    // Text to image

	// Audio domain tasks
	TaskTypeSpeechToText = "speech_to_text" // Audio to text (ASR/STT)
	TaskTypeTextToSpeech = "text_to_speech" // Text to audio (TTS)

	// Video domain tasks
	TaskTypeVideoUnderstanding = "video_understanding" // Video to text
	TaskTypeVideoGeneration    = "video_generation"    // Text to video

	// Cross-domain tasks (can appear in multiple domains)
	TaskTypeRerank = "rerank" // Relevance scoring
)

// SupportedTaskTypes all valid task type values
var SupportedTaskTypes = map[string]struct{}{
	TaskTypeChat:               {},
	TaskTypeTextEmbedding:      {},
	TaskTypeImageUnderstanding: {},
	TaskTypeImageGeneration:    {},
	TaskTypeSpeechToText:       {},
	TaskTypeTextToSpeech:       {},
	TaskTypeVideoUnderstanding: {},
	TaskTypeVideoGeneration:    {},
	TaskTypeRerank:             {},
}

// DomainTaskMapping maps domains to their supported task types
var DomainTaskMapping = map[string][]string{
	DomainLanguage:   {TaskTypeChat},
	DomainEmbedding:  {TaskTypeTextEmbedding, TaskTypeRerank},
	DomainVision:     {TaskTypeChat, TaskTypeImageUnderstanding, TaskTypeImageGeneration},
	DomainAudio:      {TaskTypeChat, TaskTypeSpeechToText, TaskTypeTextToSpeech},
	DomainVideo:      {TaskTypeChat, TaskTypeVideoUnderstanding, TaskTypeVideoGeneration},
	DomainMultimodal: {TaskTypeChat, TaskTypeImageUnderstanding, TaskTypeImageGeneration, TaskTypeSpeechToText, TaskTypeTextToSpeech, TaskTypeVideoUnderstanding, TaskTypeVideoGeneration},
}

// ModelCapabilities represents functional features that a model supports.
// These describe HOW the model works, not WHAT data it accepts (that's in Modalities).
// All fields are optional and default to false when omitted.
type ModelCapabilities struct {
	// Generation capabilities
	Reasoning    bool `json:"reasoning,omitempty"`     // Chain-of-thought / deep thinking (e.g., o1, DeepSeek-R1)
	FunctionCall bool `json:"function_call,omitempty"` // Tool use / function calling
	Streaming    bool `json:"streaming,omitempty"`     // Streaming response support
	JSONMode     bool `json:"json_mode,omitempty"`     // Structured JSON output

	// Context capabilities
	SystemPrompt   bool `json:"system_prompt,omitempty"`   // System prompt support
	ContextCaching bool `json:"context_caching,omitempty"` // KV cache / prompt caching

	// Real-time capabilities
	Realtime bool `json:"realtime,omitempty"` // Real-time streaming (e.g., GPT-4o Realtime API)

	// Processing capabilities
	Batch bool `json:"batch,omitempty"` // Batch/async processing support
}

// ModelLimits represents optional size limits.
type ModelLimits struct {
	MaxTokens     int   `json:"max_tokens"`
	ContextWindow int   `json:"context_window"`
	Dimensions    []int `json:"dimensions,omitempty"` // Embedding output dimensions (first is default)
	BatchSize     int   `json:"batch_size,omitempty"` // Max batch size for embedding
}

// ModelConfig unified struct containing common fields and vendor extension fields.
// Extra stores vendor specific additional parameters.
//
// Domain indicates the high-level category of the model (language, vision, audio, etc.).
// TaskTypes indicates the specific tasks the model can perform within its domain.
type ModelConfig struct {
	ID           string                 `json:"id"`
	Provider     string                 `json:"provider"`
	Domain       string                 `json:"domain"`                 // High-level category (language, vision, audio, etc.)
	TaskTypes    []string               `json:"task_types"`             // Specific tasks supported (chat, image_understanding, etc.)
	Capabilities *ModelCapabilities     `json:"capabilities,omitempty"` // Functional features
	Limits       *ModelLimits           `json:"limits,omitempty"`       // Size limits
	Model        string                 `json:"model"`                  // Model identifier
	Name         string                 `json:"name"`                   // Display name
	BaseUrl      string                 `json:"base_url"`               // API endpoint
	ApiKey       string                 `json:"api_key"`                // API key
	Extra        map[string]interface{} `json:"extra"`                  // Vendor-specific fields
}

func (m *ModelConfig) Normalize() {
	if m.Domain == "" {
		m.Domain = DomainLanguage
	}
	if len(m.TaskTypes) == 0 {
		m.TaskTypes = []string{TaskTypeChat}
	}
	if m.Extra == nil {
		m.Extra = map[string]interface{}{}
	}
}

// Get model storage file path
func getModelFilePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return modelFileName // fallback
	}
	return filepath.Join(home, modelFileName)
}

// Load model list
func LoadModels() ([]*ModelConfig, error) {
	path := getModelFilePath()
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return []*ModelConfig{}, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var models []*ModelConfig
	if err := json.Unmarshal(data, &models); err != nil {
		return nil, err
	}
	for _, m := range models {
		if m != nil {
			m.Normalize()
		}
	}
	return models, nil
}

// Save model list
func SaveModels(models []*ModelConfig) error {
	path := getModelFilePath()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	for _, m := range models {
		if m != nil {
			m.Normalize()
		}
	}
	data, err := json.MarshalIndent(models, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

// SupportedModelProviders supported model providers
var SupportedModelProviders = map[string]struct{}{
	"openai":    {},
	"deepseek":  {},
	"anthropic": {},
	"google":    {},
	"ark":       {},
	"ollama":    {},
	"qianfan":   {},
	"qwen":      {},
	"custom":    {},
}
