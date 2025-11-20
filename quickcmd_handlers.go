package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/imliuda/omniterm/pkg/models"
	"github.com/imliuda/omniterm/pkg/service"
)

// quick command handlers
func (s *Server) listQuickCommands(svc *service.QuickCommandService) gin.HandlerFunc {
	return func(c *gin.Context) {
		cmds, err := svc.List()
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.Response{Code: 500, Message: err.Error()})
			return
		}
		resp := make([]models.QuickCommand, 0, len(cmds))
		for _, cc := range cmds {
			resp = append(resp, *cc)
		}
		c.JSON(http.StatusOK, models.Response{Code: 200, Message: "OK", Data: models.QuickCommandListResponse{Commands: resp, Total: len(resp)}})
	}
}

func (s *Server) getQuickCommand(svc *service.QuickCommandService) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		cc, err := svc.Get(id)
		if err != nil {
			c.JSON(http.StatusNotFound, models.Response{Code: 404, Message: err.Error()})
			return
		}
		c.JSON(http.StatusOK, models.Response{Code: 200, Message: "OK", Data: cc})
	}
}

func (s *Server) createQuickCommand(svc *service.QuickCommandService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.CreateQuickCommandRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "Invalid request: " + err.Error()})
			return
		}
		cc, err := svc.Create(&req)
		if err != nil {
			c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
			return
		}
		c.JSON(http.StatusCreated, models.Response{Code: 200, Message: "Created", Data: cc})
	}
}

func (s *Server) updateQuickCommand(svc *service.QuickCommandService) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var req models.UpdateQuickCommandRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "Invalid request: " + err.Error()})
			return
		}
		cc, err := svc.Update(id, &req)
		if err != nil {
			c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
			return
		}
		c.JSON(http.StatusOK, models.Response{Code: 200, Message: "Updated", Data: cc})
	}
}

func (s *Server) deleteQuickCommand(svc *service.QuickCommandService) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if err := svc.Delete(id); err != nil {
			c.JSON(http.StatusNotFound, models.Response{Code: 404, Message: err.Error()})
			return
		}
		c.JSON(http.StatusOK, models.Response{Code: 200, Message: "Deleted"})
	}
}

func (s *Server) reorderQuickCommands(svc *service.QuickCommandService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.ReorderQuickCommandsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "Invalid request: " + err.Error()})
			return
		}
		cmds, err := svc.Reorder(req.IDs)
		if err != nil {
			c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
			return
		}
		resp := make([]models.QuickCommand, 0, len(cmds))
		for _, cc := range cmds {
			resp = append(resp, *cc)
		}
		c.JSON(http.StatusOK, models.Response{Code: 200, Message: "Reordered", Data: models.QuickCommandListResponse{Commands: resp, Total: len(resp)}})
	}
}
