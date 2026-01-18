package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"
)

// WorkspaceAgent represents a composed agent graph on the canvas
// Agent (single agent config) is defined in ADK/frontend, stored as part of WorkspaceAgent.Nodes
type WorkspaceAgent struct {
	ID          string    `json:"id" gorm:"primaryKey;size:36"`
	WorkspaceID string    `json:"workspace_id" gorm:"index;size:36;not null"`
	Name        string    `json:"name" gorm:"size:100;not null"`
	Description *string   `json:"description,omitempty" gorm:"size:500"`
	Enabled     bool      `json:"enabled" gorm:"default:true"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`

	// Canvas nodes and edges
	Nodes    WorkspaceAgentNodes     `json:"nodes" gorm:"type:json"`
	Edges    WorkspaceAgentEdges     `json:"edges" gorm:"type:json"`
	Viewport *WorkspaceAgentViewport `json:"viewport,omitempty" gorm:"type:json"`

	// Entry node ID (the node connected from start)
	EntryNodeID *string `json:"entry_node_id,omitempty" gorm:"size:36"`
}

// TableName returns the table name for WorkspaceAgent
func (WorkspaceAgent) TableName() string {
	return "workspace_agents"
}

// WorkspaceAgentViewport stores the canvas viewport state
type WorkspaceAgentViewport struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Zoom float64 `json:"zoom"`
}

// Value implements driver.Valuer for WorkspaceAgentViewport
func (v *WorkspaceAgentViewport) Value() (driver.Value, error) {
	if v == nil {
		return nil, nil
	}
	return json.Marshal(v)
}

// Scan implements sql.Scanner for WorkspaceAgentViewport
func (v *WorkspaceAgentViewport) Scan(value interface{}) error {
	if value == nil {
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return errors.New("type assertion to []byte failed")
	}
	return json.Unmarshal(bytes, v)
}

// Agent represents a single agent configuration (embedded in WorkspaceAgentNode)
type Agent struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Type          string   `json:"type"` // chat_model, supervisor, deep, plan_execute, sequential, loop, parallel
	Description   *string  `json:"description,omitempty"`
	Enabled       *bool    `json:"enabled,omitempty"`
	ModelID       *string  `json:"modelId,omitempty"`
	Instruction   *string  `json:"instruction,omitempty"`
	ToolIDs       []string `json:"toolIds,omitempty"`
	SubAgentIDs   []string `json:"subAgentIds,omitempty"`
	TypeConfig    JSONMap  `json:"typeConfig,omitempty"`
	MaxIterations *int     `json:"maxIterations,omitempty"`
	AIHint        *string  `json:"aiHint,omitempty"`
}

// WorkspaceAgentNode represents a node on the canvas
type WorkspaceAgentNode struct {
	ID       string                     `json:"id"`                 // Unique node ID
	Type     string                     `json:"type"`               // "agent" or "start"
	AgentID  *string                    `json:"agent_id,omitempty"` // Legacy: Reference to Agent.id
	Agent    *Agent                     `json:"agent,omitempty"`    // Embedded agent configuration
	Position WorkspaceAgentNodePosition `json:"position"`
}

// WorkspaceAgentNodePosition stores x,y coordinates
type WorkspaceAgentNodePosition struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// WorkspaceAgentNodes is a slice of WorkspaceAgentNode
type WorkspaceAgentNodes []WorkspaceAgentNode

// Value implements driver.Valuer for WorkspaceAgentNodes
func (n WorkspaceAgentNodes) Value() (driver.Value, error) {
	if n == nil {
		return "[]", nil
	}
	return json.Marshal(n)
}

// Scan implements sql.Scanner for WorkspaceAgentNodes
func (n *WorkspaceAgentNodes) Scan(value interface{}) error {
	if value == nil {
		*n = []WorkspaceAgentNode{}
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return errors.New("type assertion to []byte failed")
	}
	return json.Unmarshal(bytes, n)
}

// WorkspaceAgentEdge represents a connection between nodes
type WorkspaceAgentEdge struct {
	ID           string  `json:"id"`
	Source       string  `json:"source"`
	Target       string  `json:"target"`
	SourceHandle *string `json:"source_handle,omitempty"`
	TargetHandle *string `json:"target_handle,omitempty"`
	Label        *string `json:"label,omitempty"`
	Order        int     `json:"order"` // For sequential execution order
}

// WorkspaceAgentEdges is a slice of WorkspaceAgentEdge
type WorkspaceAgentEdges []WorkspaceAgentEdge

// Value implements driver.Valuer for WorkspaceAgentEdges
func (e WorkspaceAgentEdges) Value() (driver.Value, error) {
	if e == nil {
		return "[]", nil
	}
	return json.Marshal(e)
}

// Scan implements sql.Scanner for WorkspaceAgentEdges
func (e *WorkspaceAgentEdges) Scan(value interface{}) error {
	if value == nil {
		*e = []WorkspaceAgentEdge{}
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return errors.New("type assertion to []byte failed")
	}
	return json.Unmarshal(bytes, e)
}

// =====================================
// Helper methods
// =====================================

// GetEntryAgentID returns the agent ID of the entry node
func (w *WorkspaceAgent) GetEntryAgentID() *string {
	if w.EntryNodeID == nil {
		return nil
	}
	for _, node := range w.Nodes {
		if node.ID == *w.EntryNodeID && node.AgentID != nil {
			return node.AgentID
		}
	}
	return nil
}

// GetSubAgentIDs returns the ordered list of sub-agent IDs for a given node
func (w *WorkspaceAgent) GetSubAgentIDs(nodeID string) []string {
	// Find edges from this node, sorted by Order
	var edges []WorkspaceAgentEdge
	for _, edge := range w.Edges {
		if edge.Source == nodeID && edge.Target != "start" {
			edges = append(edges, edge)
		}
	}

	// Sort by Order
	for i := 0; i < len(edges); i++ {
		for j := i + 1; j < len(edges); j++ {
			if edges[i].Order > edges[j].Order {
				edges[i], edges[j] = edges[j], edges[i]
			}
		}
	}

	// Get agent IDs
	var agentIDs []string
	for _, edge := range edges {
		for _, node := range w.Nodes {
			if node.ID == edge.Target && node.AgentID != nil {
				agentIDs = append(agentIDs, *node.AgentID)
				break
			}
		}
	}

	return agentIDs
}
