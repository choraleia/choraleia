package handler

import (
	"net/http"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/gin-gonic/gin"
)

// GetPresets HTTP handler to return presets config
func GetPresets(c *gin.Context) {
	config, err := models.LoadPresets()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Failed to load presets: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 200, "data": config})
}
