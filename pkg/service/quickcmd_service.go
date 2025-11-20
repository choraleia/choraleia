package service

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/imliuda/omniterm/pkg/models"
)

// QuickCommandService manages quick commands in-memory with JSON file persistence.
type QuickCommandService struct {
	mu       sync.RWMutex
	store    map[string]*models.QuickCommand
	order    []string // maintain ordering
	dataFile string   // JSON persistence file path
}

// NewQuickCommandService initializes service and loads persisted commands.
func NewQuickCommandService() *QuickCommandService {
	homeDir, _ := os.UserHomeDir()
	dataDir := filepath.Join(homeDir, ".omniterm")
	_ = os.MkdirAll(dataDir, 0755)
	svc := &QuickCommandService{store: make(map[string]*models.QuickCommand), order: []string{}, dataFile: filepath.Join(dataDir, "quickcmds.json")}
	_ = svc.load() // best-effort load
	return svc
}

// load reads commands from JSON file if it exists.
func (s *QuickCommandService) load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := os.Stat(s.dataFile); os.IsNotExist(err) {
		return nil
	}
	data, err := os.ReadFile(s.dataFile)
	if err != nil {
		return err
	}
	var list []models.QuickCommand
	if err := json.Unmarshal(data, &list); err != nil {
		return err
	}
	// sort by Order ascending to rebuild order slice deterministically
	sort.Slice(list, func(i, j int) bool { return list[i].Order < list[j].Order })
	s.store = make(map[string]*models.QuickCommand, len(list))
	s.order = make([]string, 0, len(list))
	for i := range list {
		cmd := list[i]
		s.store[cmd.ID] = &cmd
		s.order = append(s.order, cmd.ID)
	}
	return nil
}

// save persists current state to JSON file.
func (s *QuickCommandService) save() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	list := make([]models.QuickCommand, 0, len(s.order))
	for i, id := range s.order {
		if c, ok := s.store[id]; ok {
			// set Order explicitly based on current position
			c.Order = i
			list = append(list, *c)
		}
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.dataFile, data, 0644)
}

func (s *QuickCommandService) List() ([]*models.QuickCommand, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	res := make([]*models.QuickCommand, 0, len(s.order))
	for i, id := range s.order {
		if c, ok := s.store[id]; ok {
			cc := cloneQuickCmd(c)
			cc.Order = i
			res = append(res, cc)
		}
	}
	return res, nil
}

func (s *QuickCommandService) Get(id string) (*models.QuickCommand, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c, ok := s.store[id]
	if !ok {
		return nil, errors.New("quick command not found")
	}
	cc := cloneQuickCmd(c)
	for i, oid := range s.order {
		if oid == id {
			cc.Order = i
			break
		}
	}
	return cc, nil
}

func (s *QuickCommandService) Create(req *models.CreateQuickCommandRequest) (*models.QuickCommand, error) {
	if req.Name == "" || req.Content == "" {
		return nil, errors.New("name and content required")
	}
	id := uuid.New().String()
	now := time.Now().UTC()
	cmd := &models.QuickCommand{ID: id, Name: req.Name, Content: req.Content, Tags: req.Tags, Order: len(s.order), UpdatedAt: now}
	s.mu.Lock()
	s.store[id] = cmd
	s.order = append(s.order, id)
	s.mu.Unlock()
	if err := s.save(); err != nil {
		// rollback
		s.mu.Lock()
		delete(s.store, id)
		s.order = s.order[:len(s.order)-1]
		s.mu.Unlock()
		return nil, err
	}
	return cloneQuickCmd(cmd), nil
}

func (s *QuickCommandService) Update(id string, req *models.UpdateQuickCommandRequest) (*models.QuickCommand, error) {
	s.mu.Lock()
	cmd, ok := s.store[id]
	if !ok {
		s.mu.Unlock()
		return nil, errors.New("quick command not found")
	}
	old := cloneQuickCmd(cmd) // snapshot for rollback
	if req.Name != nil {
		cmd.Name = *req.Name
	}
	if req.Content != nil {
		cmd.Content = *req.Content
	}
	if req.Tags != nil {
		cmd.Tags = *req.Tags
	}
	cmd.UpdatedAt = time.Now().UTC()
	s.mu.Unlock()
	if err := s.save(); err != nil {
		// rollback modifications
		s.mu.Lock()
		cmd.Name = old.Name
		cmd.Content = old.Content
		cmd.Tags = append([]string{}, old.Tags...)
		cmd.UpdatedAt = old.UpdatedAt
		s.mu.Unlock()
		return nil, err
	}
	return cloneQuickCmd(cmd), nil
}

func (s *QuickCommandService) Delete(id string) error {
	s.mu.Lock()
	cmd, ok := s.store[id]
	if !ok {
		s.mu.Unlock()
		return errors.New("quick command not found")
	}
	// snapshot for potential rollback
	oldCmd := cloneQuickCmd(cmd)
	oldOrder := append([]string{}, s.order...)
	delete(s.store, id)
	for i, oid := range s.order {
		if oid == id {
			s.order = append(s.order[:i], s.order[i+1:]...)
			break
		}
	}
	s.mu.Unlock()
	if err := s.save(); err != nil {
		// rollback
		s.mu.Lock()
		s.store[id] = oldCmd
		s.order = oldOrder
		s.mu.Unlock()
		return err
	}
	return nil
}

func (s *QuickCommandService) Reorder(ids []string) ([]*models.QuickCommand, error) {
	s.mu.Lock()
	for _, id := range ids {
		if _, ok := s.store[id]; !ok {
			s.mu.Unlock()
			return nil, errors.New("invalid id in reorder list")
		}
	}
	oldOrder := append([]string{}, s.order...)
	seen := map[string]struct{}{}
	newOrder := make([]string, 0, len(ids))
	for _, id := range ids {
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			newOrder = append(newOrder, id)
		}
	}
	for _, id := range s.order {
		if _, ok := seen[id]; !ok {
			newOrder = append(newOrder, id)
		}
	}
	s.order = newOrder
	// update Order values in store prior to save
	for i, id := range s.order {
		if c, ok := s.store[id]; ok {
			c.Order = i
		}
	}
	s.mu.Unlock()
	if err := s.save(); err != nil {
		// rollback
		s.mu.Lock()
		s.order = oldOrder
		for i, id := range s.order {
			if c, ok := s.store[id]; ok {
				c.Order = i
			}
		}
		s.mu.Unlock()
		return nil, err
	}
	return s.List()
}

func (s *QuickCommandService) normalize() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.order) == 0 && len(s.store) > 0 {
		ids := make([]string, 0, len(s.store))
		for id := range s.store {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		s.order = ids
	}
}

func cloneQuickCmd(c *models.QuickCommand) *models.QuickCommand {
	if c == nil {
		return nil
	}
	cc := *c
	cc.Tags = append([]string{}, c.Tags...)
	return &cc
}
