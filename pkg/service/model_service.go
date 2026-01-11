package service

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/utils"
	"github.com/cloudwego/eino-ext/components/model/ark"
	"github.com/cloudwego/eino-ext/components/model/claude"
	"github.com/cloudwego/eino-ext/components/model/deepseek"
	"github.com/cloudwego/eino-ext/components/model/gemini"
	"github.com/cloudwego/eino-ext/components/model/ollama"
	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino-ext/components/model/qianfan"
	"github.com/cloudwego/eino-ext/components/model/qwen"
	einoModel "github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"google.golang.org/genai"
)

type ModelService struct {
	logger *slog.Logger
}

func NewModelService() *ModelService {
	return &ModelService{
		logger: utils.GetLogger(),
	}
}

// GetModelList fetch model list
// Supports optional query parameters:
// - domain: filter by domain (e.g., "vision", "multimodal", "language")
// - task_types: filter by task type (e.g., "image_understanding", "chat")
func (m *ModelService) GetModelList(c *gin.Context) {
	modelsList, err := models.LoadModels()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Failed to read model list"})
		return
	}

	// Get filter parameters
	domainFilter := c.Query("domain")
	taskTypesFilter := c.Query("task_types")

	var filteredModels []*models.ModelConfig
	for _, mm := range modelsList {
		mm.Normalize()
		mm.ApiKey = utils.MaskSensitiveString(mm.ApiKey)

		// Apply domain filter
		if domainFilter != "" {
			if mm.Domain != domainFilter {
				// Also check if it's a multimodal model when filtering for vision
				if !(domainFilter == models.DomainVision && mm.Domain == models.DomainMultimodal) {
					continue
				}
			}
		}

		// Apply task_types filter
		if taskTypesFilter != "" {
			hasTaskType := false
			for _, t := range mm.TaskTypes {
				if t == taskTypesFilter {
					hasTaskType = true
					break
				}
			}
			if !hasTaskType {
				continue
			}
		}

		filteredModels = append(filteredModels, mm)
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "data": filteredModels})
}

// AddModel add a new model
func (m *ModelService) AddModel(c *gin.Context) {
	var req models.ModelConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Invalid parameters"})
		return
	}
	req.Normalize()
	if req.Name == "" || req.Provider == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Name and provider required"})
		return
	}
	if _, ok := models.SupportedModelProviders[req.Provider]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Unsupported model provider"})
		return
	}
	currentModels, err := models.LoadModels()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Failed to read model list"})
		return
	}
	for _, mm := range currentModels {
		if mm.Name == req.Name {
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Model name already exists"})
			return
		}
	}
	req.ID = uuid.New().String()
	currentModels = append(currentModels, &req)
	if err := models.SaveModels(currentModels); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Failed to save model"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "Added successfully"})
}

// EditModel update an existing model
func (m *ModelService) EditModel(c *gin.Context) {
	id := c.Param("id")
	var req models.ModelConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Invalid parameters"})
		return
	}
	req.Normalize()
	if req.Name == "" || req.Provider == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Name and provider required"})
		return
	}
	if _, ok := models.SupportedModelProviders[req.Provider]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Unsupported model provider"})
		return
	}

	currentModels, err := models.LoadModels()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Failed to read model list"})
		return
	}
	found := false
	for i, mm := range currentModels {
		if mm.ID == id {
			// Name uniqueness check
			for _, other := range currentModels {
				if other.Name == req.Name && other.ID != id {
					c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Model name already exists"})
					return
				}
			}
			currentModels[i] = &req
			currentModels[i].ID = id // keep ID unchanged
			found = true
			break
		}
	}
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "Model not found"})
		return
	}
	if err := models.SaveModels(currentModels); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Failed to save model"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "Updated successfully"})
}

// DeleteModel delete model
func (m *ModelService) DeleteModel(c *gin.Context) {
	id := c.Param("id")
	currentModels, err := models.LoadModels()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Failed to read model list"})
		return
	}
	idx := -1
	for i, mm := range currentModels {
		if mm.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "Model not found"})
		return
	}
	currentModels = append(currentModels[:idx], currentModels[idx+1:]...)
	if err := models.SaveModels(currentModels); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Failed to save model"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "Deleted successfully"})
}

// TestModelConnection connectivity test for model provider
func (m *ModelService) TestModelConnection(c *gin.Context) {
	var req models.ModelConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Invalid parameters: " + err.Error()})
		return
	}
	req.Normalize()
	if req.Provider == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Provider required"})
		return
	}

	// For non-chat task types, skip actual API test
	hasChat := false
	for _, t := range req.TaskTypes {
		if t == models.TaskTypeChat {
			hasChat = true
			break
		}
	}
	if !hasChat && len(req.TaskTypes) > 0 {
		c.JSON(http.StatusOK, gin.H{
			"code":    200,
			"success": true,
			"message": "Configuration looks valid (non-chat task type test not implemented yet)",
		})
		return
	}

	ctx := context.Background()
	testMessages := []*schema.Message{{Role: schema.User, Content: "Hi"}}

	switch req.Provider {
	case "openai", "custom":
		chatModel, err := openai.NewChatModel(ctx, &openai.ChatModelConfig{
			BaseURL: req.BaseUrl,
			APIKey:  req.ApiKey,
			Model:   req.Model,
		})
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"code": 200, "success": false, "message": "Model init failed: " + err.Error()})
			return
		}
		_, err = chatModel.Generate(ctx, testMessages)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"code": 200, "success": false, "message": "Connection failed: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"code": 200, "success": true, "message": "Connection successful"})

	case "ark":
		region := ""
		if v, ok := req.Extra["region"]; ok {
			region, _ = v.(string)
		}
		chatModel, err := ark.NewChatModel(ctx, &ark.ChatModelConfig{
			BaseURL: req.BaseUrl,
			APIKey:  req.ApiKey,
			Model:   req.Model,
			Region:  region,
		})
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"code": 200, "success": false, "message": "Model init failed: " + err.Error()})
			return
		}
		_, err = chatModel.Generate(ctx, testMessages)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"code": 200, "success": false, "message": "Connection failed: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"code": 200, "success": true, "message": "Connection successful"})

	case "deepseek":
		chatModel, err := deepseek.NewChatModel(ctx, &deepseek.ChatModelConfig{
			BaseURL: req.BaseUrl,
			APIKey:  req.ApiKey,
			Model:   req.Model,
		})
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"code": 200, "success": false, "message": "Model init failed: " + err.Error()})
			return
		}
		_, err = chatModel.Generate(ctx, testMessages)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"code": 200, "success": false, "message": "Connection failed: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"code": 200, "success": true, "message": "Connection successful"})

	case "anthropic":
		chatModel, err := claude.NewChatModel(ctx, &claude.Config{
			BaseURL:   &req.BaseUrl,
			APIKey:    req.ApiKey,
			Model:     req.Model,
			MaxTokens: 1024,
		})
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"code": 200, "success": false, "message": "Model init failed: " + err.Error()})
			return
		}
		_, err = chatModel.Generate(ctx, testMessages)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"code": 200, "success": false, "message": "Connection failed: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"code": 200, "success": true, "message": "Connection successful"})

	case "ollama":
		chatModel, err := ollama.NewChatModel(ctx, &ollama.ChatModelConfig{
			BaseURL: req.BaseUrl,
			Model:   req.Model,
		})
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"code": 200, "success": false, "message": "Model init failed: " + err.Error()})
			return
		}
		_, err = chatModel.Generate(ctx, testMessages)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"code": 200, "success": false, "message": "Connection failed: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"code": 200, "success": true, "message": "Connection successful"})

	case "google":
		genaiClient, err := genai.NewClient(ctx, &genai.ClientConfig{
			APIKey:  req.ApiKey,
			Backend: genai.BackendGeminiAPI,
		})
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"code": 200, "success": false, "message": "Gemini client init failed: " + err.Error()})
			return
		}
		chatModel, err := gemini.NewChatModel(ctx, &gemini.Config{
			Client: genaiClient,
			Model:  req.Model,
		})
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"code": 200, "success": false, "message": "Model init failed: " + err.Error()})
			return
		}
		_, err = chatModel.Generate(ctx, testMessages)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"code": 200, "success": false, "message": "Connection failed: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"code": 200, "success": true, "message": "Connection successful"})

	case "qianfan":
		qianfanConfig := qianfan.GetQianfanSingletonConfig()
		qianfanConfig.BaseURL = req.BaseUrl
		qianfanConfig.BearerToken = req.ApiKey
		chatModel, err := qianfan.NewChatModel(ctx, &qianfan.ChatModelConfig{
			Model: req.Model,
		})
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"code": 200, "success": false, "message": "Model init failed: " + err.Error()})
			return
		}
		_, err = chatModel.Generate(ctx, testMessages)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"code": 200, "success": false, "message": "Connection failed: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"code": 200, "success": true, "message": "Connection successful"})

	case "qwen":
		chatModel, err := qwen.NewChatModel(ctx, &qwen.ChatModelConfig{
			BaseURL: req.BaseUrl,
			APIKey:  req.ApiKey,
			Model:   req.Model,
		})
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"code": 200, "success": false, "message": "Model init failed: " + err.Error()})
			return
		}
		_, err = chatModel.Generate(ctx, testMessages)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"code": 200, "success": false, "message": "Connection failed: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"code": 200, "success": true, "message": "Connection successful"})

	default:
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Unknown provider"})
	}
}

// CreateChatModel creates an eino chat model from config
func (m *ModelService) CreateChatModel(ctx context.Context, config *models.ModelConfig) (einoModel.ToolCallingChatModel, error) {
	if config == nil {
		return nil, fmt.Errorf("model config is nil")
	}

	switch config.Provider {
	case "openai", "custom":
		chatModel, err := openai.NewChatModel(ctx, &openai.ChatModelConfig{
			BaseURL: config.BaseUrl,
			APIKey:  config.ApiKey,
			Model:   config.Model,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create OpenAI model: %w", err)
		}
		return chatModel, nil

	case "ark":
		timeout := time.Second * 600
		retries := 3
		region := ""
		if config.Extra != nil {
			if v, ok := config.Extra["region"]; ok {
				region, _ = v.(string)
			}
		}
		chatModel, err := ark.NewChatModel(ctx, &ark.ChatModelConfig{
			BaseURL:    config.BaseUrl,
			Region:     region,
			Timeout:    &timeout,
			RetryTimes: &retries,
			APIKey:     config.ApiKey,
			Model:      config.Model,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create Ark model: %w", err)
		}
		return chatModel, nil

	case "deepseek":
		chatModel, err := deepseek.NewChatModel(ctx, &deepseek.ChatModelConfig{
			BaseURL: config.BaseUrl,
			APIKey:  config.ApiKey,
			Model:   config.Model,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create DeepSeek model: %w", err)
		}
		return chatModel, nil

	case "anthropic":
		chatModel, err := claude.NewChatModel(ctx, &claude.Config{
			BaseURL:   &config.BaseUrl,
			APIKey:    config.ApiKey,
			Model:     config.Model,
			MaxTokens: 8192,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create Claude model: %w", err)
		}
		return chatModel, nil

	case "ollama":
		chatModel, err := ollama.NewChatModel(ctx, &ollama.ChatModelConfig{
			BaseURL: config.BaseUrl,
			Model:   config.Model,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create Ollama model: %w", err)
		}
		return chatModel, nil

	case "google":
		genaiClient, err := genai.NewClient(ctx, &genai.ClientConfig{
			APIKey:  config.ApiKey,
			Backend: genai.BackendGeminiAPI,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create Gemini client: %w", err)
		}
		chatModel, err := gemini.NewChatModel(ctx, &gemini.Config{
			Client: genaiClient,
			Model:  config.Model,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create Gemini model: %w", err)
		}
		return chatModel, nil

	case "qianfan":
		qianfanConfig := qianfan.GetQianfanSingletonConfig()
		qianfanConfig.BaseURL = config.BaseUrl
		qianfanConfig.BearerToken = config.ApiKey
		chatModel, err := qianfan.NewChatModel(ctx, &qianfan.ChatModelConfig{
			Model: config.Model,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create Qianfan model: %w", err)
		}
		return chatModel, nil

	case "qwen":
		chatModel, err := qwen.NewChatModel(ctx, &qwen.ChatModelConfig{
			BaseURL: config.BaseUrl,
			APIKey:  config.ApiKey,
			Model:   config.Model,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create Qwen model: %w", err)
		}
		return chatModel, nil

	default:
		return nil, fmt.Errorf("unsupported model provider: %s", config.Provider)
	}
}

// GetModelConfig get specified model config (match by name or model field)
func (m *ModelService) GetModelConfig(modelName string) (*models.ModelConfig, error) {
	currentModels, err := models.LoadModels()
	if err != nil {
		return nil, err
	}
	for _, mm := range currentModels {
		mm.Normalize()
		if mm.Name == modelName || mm.Model == modelName {
			return mm, nil
		}
	}
	return nil, nil // not found
}

// GetProviderApiKeys returns saved API keys and base URLs for a specific provider
func (m *ModelService) GetProviderApiKeys(c *gin.Context) {
	provider := c.Query("provider")
	if provider == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Provider parameter required"})
		return
	}

	currentModels, err := models.LoadModels()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Failed to read model list"})
		return
	}

	// Use map to deduplicate
	apiKeySet := make(map[string]struct{})
	baseUrlSet := make(map[string]struct{})

	for _, mm := range currentModels {
		if mm.Provider == provider {
			if mm.ApiKey != "" {
				apiKeySet[mm.ApiKey] = struct{}{}
			}
			if mm.BaseUrl != "" {
				baseUrlSet[mm.BaseUrl] = struct{}{}
			}
		}
	}

	// Convert to slices with masked display
	type KeyInfo struct {
		Value   string `json:"value"`
		Display string `json:"display"`
	}

	var apiKeys []KeyInfo
	for key := range apiKeySet {
		apiKeys = append(apiKeys, KeyInfo{
			Value:   key,
			Display: utils.MaskSensitiveString(key),
		})
	}

	var baseUrls []string
	for url := range baseUrlSet {
		baseUrls = append(baseUrls, url)
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 200,
		"data": gin.H{
			"api_keys":  apiKeys,
			"base_urls": baseUrls,
		},
	})
}
