package service

import (
	"encoding/json"
	"fmt"
	"github.com/choraleia/choraleia/pkg/models"
	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// AssetService asset management service (in-memory + file persistence)
type AssetService struct {
	dataFile string
	assets   map[string]*models.Asset
}

// NewAssetService creates a new asset service instance
func NewAssetService() *AssetService {
	homeDir, _ := os.UserHomeDir()
	dataDir := filepath.Join(homeDir, ".choraleia")
	_ = os.MkdirAll(dataDir, 0755)

	service := &AssetService{
		dataFile: filepath.Join(dataDir, "assets.json"),
		assets:   make(map[string]*models.Asset),
	}
	_ = service.loadAssets()
	return service
}

// loadAssets loads assets data from file
func (s *AssetService) loadAssets() error {
	if _, err := os.Stat(s.dataFile); os.IsNotExist(err) {
		return nil
	}
	data, err := os.ReadFile(s.dataFile)
	if err != nil {
		return err
	}
	var list []models.Asset
	if err := json.Unmarshal(data, &list); err != nil {
		return err
	}
	for i := range list {
		asset := list[i]
		s.assets[asset.ID] = &asset
	}
	return nil
}

// saveAssets persists assets to file
func (s *AssetService) saveAssets() error {
	list := make([]models.Asset, 0, len(s.assets))
	for _, a := range s.assets {
		list = append(list, *a)
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.dataFile, data, 0644)
}

// CreateAsset creates a new asset, appending at tail of sibling list
func (s *AssetService) CreateAsset(req *models.CreateAssetRequest) (*models.Asset, error) {
	asset := &models.Asset{
		ID:          uuid.New().String(),
		Name:        req.Name,
		Type:        req.Type,
		Description: req.Description,
		Config:      req.Config,
		Tags:        req.Tags,
		ParentID:    req.ParentID,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	if err := asset.ValidateConfig(); err != nil {
		return nil, fmt.Errorf("config validation failed: %v", err)
	}
	// append at tail
	if tail := s.findTail(req.ParentID); tail != nil {
		asset.PrevID = &tail.ID
		tail.NextID = &asset.ID
	}
	s.assets[asset.ID] = asset
	if err := s.saveAssets(); err != nil {
		return nil, fmt.Errorf("failed to save asset: %v", err)
	}
	return asset, nil
}

// findTail finds last sibling with given parent (NextID == nil)
func (s *AssetService) findTail(parentID *string) *models.Asset {
	var tail *models.Asset
	for _, a := range s.assets {
		if (a.ParentID == nil && parentID == nil) || (a.ParentID != nil && parentID != nil && *a.ParentID == *parentID) {
			if a.NextID == nil { // possible multiple tails if broken; latest wins
				tail = a
			}
		}
	}
	return tail
}

// findHead finds a head sibling (PrevID == nil)
func (s *AssetService) findHead(parentID *string) *models.Asset {
	for _, a := range s.assets {
		if (a.ParentID == nil && parentID == nil) || (a.ParentID != nil && parentID != nil && *a.ParentID == *parentID) {
			if a.PrevID == nil {
				return a
			}
		}
	}
	return nil
}

// detach removes a node from its current sibling linked list
func (s *AssetService) detach(a *models.Asset) {
	if a.PrevID != nil {
		if prev, ok := s.assets[*a.PrevID]; ok {
			prev.NextID = a.NextID
		}
	}
	if a.NextID != nil {
		if next, ok := s.assets[*a.NextID]; ok {
			next.PrevID = a.PrevID
		}
	}
	a.PrevID = nil
	a.NextID = nil
}

// insertAppend appends node at end for its parent
func (s *AssetService) insertAppend(a *models.Asset) {
	if tail := s.findTail(a.ParentID); tail != nil {
		tail.NextID = &a.ID
		a.PrevID = &tail.ID
	}
}

// MoveAsset moves an asset relative to target sibling or append
func (s *AssetService) MoveAsset(id string, req *models.MoveAssetRequest) (*models.Asset, error) {
	a, ok := s.assets[id]
	if !ok {
		return nil, fmt.Errorf("asset not found")
	}
	// Validate target parent chain to avoid moving into itself or its descendant
	if req.NewParentID != nil {
		if *req.NewParentID == id {
			return nil, fmt.Errorf("cannot move asset into itself")
		}
		visited := make(map[string]struct{})
		curID := req.NewParentID
		for curID != nil {
			if _, seen := visited[*curID]; seen { // Guard against potential unexpected cycles
				break
			}
			visited[*curID] = struct{}{}
			if *curID == id { // Detected that the descendant chain contains the asset itself
				return nil, fmt.Errorf("cannot move asset into its descendant")
			}
			curAsset, exists := s.assets[*curID]
			if !exists || curAsset.ParentID == nil {
				break
			}
			curID = curAsset.ParentID
		}
	}
	// detach from old list
	s.detach(a)
	// update parent
	a.ParentID = req.NewParentID
	var ref *models.Asset
	if req.TargetSiblingID != nil {
		ref = s.assets[*req.TargetSiblingID]
		if ref == nil {
			return nil, fmt.Errorf("target sibling not found")
		}
		// parent mismatch check
		if (ref.ParentID == nil && a.ParentID != nil) || (ref.ParentID != nil && a.ParentID == nil) || (ref.ParentID != nil && a.ParentID != nil && *ref.ParentID != *a.ParentID) {
			return nil, fmt.Errorf("target sibling not in same parent")
		}
	}
	pos := strings.ToLower(req.Position)
	switch pos {
	case "before":
		if ref == nil { // insert at head
			if head := s.findHead(a.ParentID); head != nil {
				head.PrevID = &a.ID
				a.NextID = &head.ID
			}
		} else {
			prevID := ref.PrevID
			if prevID != nil {
				if prev, ok := s.assets[*prevID]; ok {
					prev.NextID = &a.ID
					a.PrevID = &prev.ID
				}
			}
			a.NextID = &ref.ID
			ref.PrevID = &a.ID
		}
	case "after":
		if ref == nil { // treat as append
			s.insertAppend(a)
		} else {
			nextID := ref.NextID
			if nextID != nil {
				if next, ok := s.assets[*nextID]; ok {
					next.PrevID = &a.ID
					a.NextID = &next.ID
				}
			}
			a.PrevID = &ref.ID
			ref.NextID = &a.ID
		}
	case "append", "":
		s.insertAppend(a)
	default:
		return nil, fmt.Errorf("invalid position")
	}
	a.UpdatedAt = time.Now()
	if err := s.saveAssets(); err != nil {
		return nil, err
	}
	return a, nil
}

// GetAsset gets asset by ID
func (s *AssetService) GetAsset(id string) (*models.Asset, error) {
	asset, exists := s.assets[id]
	if !exists {
		return nil, fmt.Errorf("asset not found")
	}
	return asset, nil
}

// UpdateAsset updates an existing asset
func (s *AssetService) UpdateAsset(id string, req *models.UpdateAssetRequest) (*models.Asset, error) {
	asset, exists := s.assets[id]
	if !exists {
		return nil, fmt.Errorf("asset not found")
	}
	if req.Name != nil {
		asset.Name = *req.Name
	}
	if req.Description != nil {
		asset.Description = *req.Description
	}
	if req.Config != nil {
		asset.Config = req.Config
	}
	if req.Tags != nil {
		asset.Tags = req.Tags
	}
	asset.UpdatedAt = time.Now()
	if err := asset.ValidateConfig(); err != nil {
		return nil, fmt.Errorf("config validation failed: %v", err)
	}
	if err := s.saveAssets(); err != nil {
		return nil, fmt.Errorf("failed to save asset: %v", err)
	}
	return asset, nil
}

// DeleteAsset deletes an asset and its children recursively
func (s *AssetService) DeleteAsset(id string) error {
	asset, exists := s.assets[id]
	if !exists {
		return fmt.Errorf("asset not found")
	}
	// detach self from siblings
	s.detach(asset)
	// recursive delete children
	for cid, child := range s.assets {
		if child.ParentID != nil && *child.ParentID == id {
			_ = s.DeleteAsset(cid)
		}
	}
	delete(s.assets, id)
	return s.saveAssets()
}

// ListAssets lists assets with filters (ordering handled by client via linked list)
func (s *AssetService) ListAssets(assetType string, tags []string, search string) ([]*models.Asset, error) {
	var result []*models.Asset
	for _, asset := range s.assets {
		if assetType != "" && string(asset.Type) != assetType {
			continue
		}
		if len(tags) > 0 {
			has := false
			for _, t := range tags {
				for _, at := range asset.Tags {
					if at == t {
						has = true
						break
					}
				}
				if has {
					break
				}
			}
			if !has {
				continue
			}
		}
		if search != "" {
			q := strings.ToLower(search)
			if !strings.Contains(strings.ToLower(asset.Name), q) && !strings.Contains(strings.ToLower(asset.Description), q) {
				continue
			}
		}
		result = append(result, asset)
	}
	return result, nil
}

// ParseSSHConfig parses SSH config file
func (s *AssetService) ParseSSHConfig() ([]*models.ParsedSSHHost, error) {
	homeDir, _ := os.UserHomeDir()
	sshConfigPath := filepath.Join(homeDir, ".ssh", "config")

	if _, err := os.Stat(sshConfigPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("SSH config file not found")
	}

	data, err := os.ReadFile(sshConfigPath)
	if err != nil {
		return nil, err
	}

	return parseSSHConfigContent(string(data)), nil
}

// parseSSHConfigContent parses SSH config content
func parseSSHConfigContent(content string) []*models.ParsedSSHHost {
	var hosts []*models.ParsedSSHHost
	var current *models.ParsedSSHHost

	lines := strings.Split(content, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		key := strings.ToLower(parts[0])
		value := strings.Join(parts[1:], " ")

		switch key {
		case "host":
			if current != nil {
				hosts = append(hosts, current)
			}
			current = &models.ParsedSSHHost{
				Host: value,
				Port: 22, // default port
			}
		case "hostname":
			if current != nil {
				current.HostName = value
			}
		case "port":
			if current != nil {
				if p := parseInt(value); p > 0 {
					current.Port = p
				}
			}
		case "user":
			if current != nil {
				current.User = value
			}
		case "identityfile":
			if current != nil {
				current.IdentityFile = value
			}
		case "proxyjump":
			if current != nil {
				current.ProxyJump = value
			}
		}
	}

	if current != nil {
		hosts = append(hosts, current)
	}

	return hosts
}

// parseInt parses integer
func parseInt(s string) int {
	var r int
	_, _ = fmt.Sscanf(s, "%d", &r)
	return r
}

// ImportFromSSHConfig imports assets from SSH config
func (s *AssetService) ImportFromSSHConfig() (int, error) {
	hosts, err := s.ParseSSHConfig()
	if err != nil {
		return 0, err
	}

	imported := 0
	for _, host := range hosts {
		// skip if already exists
		exists := false
		for _, asset := range s.assets {
			if asset.Type == models.AssetTypeSSH {
				var cfg models.SSHConfig
				if err := asset.GetTypedConfig(&cfg); err == nil {
					if cfg.Host == host.HostName && cfg.Username == host.User {
						exists = true
						break
					}
				}
			}
		}
		if exists {
			continue
		}
		cfg := models.SSHConfig{
			Host:           host.HostName,
			Port:           host.Port,
			Username:       host.User,
			PrivateKeyPath: host.IdentityFile,
			ProxyJump:      host.ProxyJump,
			Timeout:        30,
		}
		if host.HostName == "" {
			cfg.Host = host.Host
		}
		cfgMap := map[string]interface{}{}
		b, _ := json.Marshal(cfg)
		_ = json.Unmarshal(b, &cfgMap)
		req := &models.CreateAssetRequest{
			Name:        host.Host,
			Type:        models.AssetTypeSSH,
			Description: fmt.Sprintf("Imported from SSH config: %s", host.Host),
			Config:      cfgMap,
			Tags:        []string{"ssh", "imported"},
		}
		if _, err := s.CreateAsset(req); err == nil {
			imported++
		}
	}

	return imported, nil
}

// ListSSHKeys lists available SSH private key files in user's ~/.ssh directory
func (s *AssetService) ListSSHKeys() ([]models.SSHKeyInfo, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	sshDir := filepath.Join(homeDir, ".ssh")
	entries, err := os.ReadDir(sshDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []models.SSHKeyInfo{}, nil
		}
		return nil, err
	}
	var keys []models.SSHKeyInfo
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if strings.HasSuffix(name, ".pub") || name == "known_hosts" || name == "authorized_keys" || strings.HasPrefix(name, "config") {
			continue
		}
		fullPath := filepath.Join(sshDir, name)
		info, ierr := s.InspectSSHKey(fullPath)
		if ierr == nil {
			keys = append(keys, info)
		}
	}
	slices.SortFunc(keys, func(a, b models.SSHKeyInfo) int { return strings.Compare(a.Path, b.Path) })
	return keys, nil
}

// InspectSSHKey inspects a single private key file and reports encryption status
func (s *AssetService) InspectSSHKey(path string) (models.SSHKeyInfo, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return models.SSHKeyInfo{}, err
	}
	if len(data) > 128*1024 {
		return models.SSHKeyInfo{}, fmt.Errorf("file too large to be a key")
	}
	_, parseErr := ssh.ParsePrivateKey(data)
	if parseErr == nil {
		return models.SSHKeyInfo{Path: path, Encrypted: false}, nil
	}
	errMsg := parseErr.Error()
	encrypted := false
	if strings.Contains(errMsg, "passphrase") || strings.Contains(errMsg, "encrypted") || strings.Contains(errMsg, "cannot decode") {
		if strings.Contains(string(data), "PRIVATE KEY") || strings.Contains(string(data), "OPENSSH") {
			encrypted = true
		}
	}
	return models.SSHKeyInfo{Path: path, Encrypted: encrypted}, nil
}
