package service

import (
	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/utils"
	"github.com/cloudwego/eino-ext/components/model/ark"
	"github.com/cloudwego/eino-ext/components/model/deepseek"
	"github.com/cloudwego/eino/schema"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"log/slog"
	"net/http"
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
func (m *ModelService) GetModelList(c *gin.Context) {
	modelsList, err := models.LoadModels()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Failed to read model list"})
		return
	}
	for _, mm := range modelsList {
		mm.ApiKey = utils.MaskSensitiveString(mm.ApiKey)
	}
	c.JSON(http.StatusOK, gin.H{"code": 200, "data": modelsList})
}

// AddModel add a new model
func (m *ModelService) AddModel(c *gin.Context) {
	var req models.ModelConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Invalid parameters"})
		return
	}
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
	if req.Extra == nil {
		req.Extra = map[string]interface{}{}
	}
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
	if req.Provider == "" || req.BaseUrl == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Provider and base_url required"})
		return
	}

	switch req.Provider {
	case "openai":
		// TODO: implement openai connectivity test
	case "ark":
		region := ""
		if v, ok := req.Extra["region"]; ok {
			region, _ = v.(string)
		}
		chatModel, err := ark.NewChatModel(c, &ark.ChatModelConfig{
			BaseURL: req.BaseUrl,
			APIKey:  req.ApiKey,
			Model:   req.Model,
			Region:  region,
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": 400, "message": "Model initialization failed: " + err.Error()})
			return
		}
		message, err := chatModel.Generate(c, []*schema.Message{{Role: schema.User, Content: "Hello"}})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": 400, "message": "Connectivity test failed: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"code": 200, "success": true, "message": "Connectivity succeeded: " + message.Content})
	case "deepseek":
		chatModel, err := deepseek.NewChatModel(c, &deepseek.ChatModelConfig{
			BaseURL: req.BaseUrl,
			APIKey:  req.ApiKey,
			Model:   req.Model,
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": 400, "message": "Model initialization failed: " + err.Error()})
			return
		}
		message, err := chatModel.Generate(c, []*schema.Message{{Role: schema.User, Content: "Hello"}})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": 400, "message": "Connectivity test failed: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"code": 200, "success": true, "message": "Connectivity succeeded: " + message.Content})
	case "claude":
	case "gemini":
	case "ollama":
	case "qianfan":
	case "qwen":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Connectivity test not supported for this provider"})
		return
	}
}

// GetModelConfig get specified model config (match by name or model field)
func (m *ModelService) GetModelConfig(modelName string) (*models.ModelConfig, error) {
	currentModels, err := models.LoadModels()
	if err != nil {
		return nil, err
	}
	for _, mm := range currentModels {
		if mm.Name == modelName || mm.Model == modelName {
			return mm, nil
		}
	}
	return nil, nil // not found
}
