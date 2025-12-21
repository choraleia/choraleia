package models

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/volcengine/volcengine-go-sdk/service/ark"
	"github.com/volcengine/volcengine-go-sdk/volcengine"
	"github.com/volcengine/volcengine-go-sdk/volcengine/request"
	"github.com/volcengine/volcengine-go-sdk/volcengine/response"
	"github.com/volcengine/volcengine-go-sdk/volcengine/session"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
)

const credFile = ".choraleia/model_provider.json"

type ArkCredentials struct {
	AK string `json:"ak"`
	SK string `json:"sk"`
}

// Ark public model list response struct
type ListFoundationModelsOutput struct {
	Metadata   *response.ResponseMetadata
	Items      []*ItemListFoundationModelOutput
	TotalCount *int64
	PageNumber *int64
	PageSize   *int64
}

type PageinatorForListFoundationModelOutput struct {
	_ struct{} `type:"structure" json:",omitempty"`

	Index *int32 `type:"int32" json:"index,omitempty"`

	Size *int32 `type:"int32" json:"size,omitempty"`

	Total_items *int32 `type:"int32" json:"total_items,omitempty"`

	Total_pages *int32 `type:"int32" json:"total_pages,omitempty"`
}

type ItemListFoundationModelOutput struct {
	Name               string             `json:"Name"`
	Description        string             `json:"Description"`
	Introduction       string             `json:"Introduction"`
	VendorName         string             `json:"VendorName"`
	DisplayName        string             `json:"DisplayName"`
	ShortName          string             `json:"ShortName"`
	FeaturedImage      FeaturedImage      `json:"FeaturedImage"`
	PrimaryVersion     string             `json:"PrimaryVersion"`
	FoundationModelTag FoundationModelTag `json:"FoundationModelTag"`
	AccessType         string             `json:"AccessType"`
	DisplayDescription string             `json:"DisplayDescription"`
	ProjectName        string             `json:"ProjectName"`
	ResourceOrigin     string             `json:"ResourceOrigin"`
	CreateTime         string             `json:"CreateTime"`
	UpdateTime         string             `json:"UpdateTime"`
}

type FeaturedImage struct {
	BucketName string `json:"BucketName"`
	ObjectKey  string `json:"ObjectKey"`
	Url        string `json:"Url,omitempty"`
}

type FoundationModelTag struct {
	Domains         []string `json:"Domains"`
	TaskTypes       []string `json:"TaskTypes"`
	CustomizedTags  []string `json:"CustomizedTags"`
	FilterDomains   []string `json:"FilterDomains"`
	FilterTaskTypes []string `json:"FilterTaskTypes"`
	ContextLength   string   `json:"ContextLength,omitempty"`
}

// ListFoundationModelsInput/Output and SDK wrapper
const opListFoundationModels = "ListFoundationModels"

type ListFoundationModelsInput struct {
	PageNumber int `json:"PageNumber,omitempty"`
	PageSize   int `json:"PageSize,omitempty"`
	// extensible for more parameters
}

// Check if credentials file exists and contains AK/SK (multi-provider management)
func GetArkCredentials(c *gin.Context) {
	home, _ := os.UserHomeDir()
	path := filepath.Join(home, credFile)
	data, err := os.ReadFile(path)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"configured": false})
		return
	}
	var all map[string]any
	_ = json.Unmarshal(data, &all)
	var cred ArkCredentials
	if v, ok := all["ark"]; ok {
		b, _ := json.Marshal(v)
		_ = json.Unmarshal(b, &cred)
	}
	if cred.AK == "" || cred.SK == "" {
		c.JSON(http.StatusOK, gin.H{"configured": false})
		return
	}
	c.JSON(http.StatusOK, gin.H{"configured": true, "ak": cred.AK, "sk": ""})
}

// Save AK/SK into credentials file (multi-provider management)
func SetArkCredentials(c *gin.Context) {
	var cred ArkCredentials
	if err := c.ShouldBindJSON(&cred); err != nil || cred.AK == "" || cred.SK == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "AK/SK required"})
		return
	}
	home, _ := os.UserHomeDir()
	path := filepath.Join(home, credFile)
	_ = os.MkdirAll(filepath.Dir(path), 0700)
	var all map[string]any
	if data, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(data, &all)
	}
	if all == nil {
		all = map[string]any{}
	}
	all["ark"] = cred
	b, _ := json.MarshalIndent(all, "", "  ")
	if err := os.WriteFile(path, b, 0600); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Save failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "Save succeeded"})
}

// Delete AK/SK credentials file (only removes ark field)
func DeleteArkCredentials(c *gin.Context) {
	home, _ := os.UserHomeDir()
	path := filepath.Join(home, credFile)
	data, err := os.ReadFile(path)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"code": 200, "message": "AK/SK does not exist"})
		return
	}
	var all map[string]any
	if err := json.Unmarshal(data, &all); err != nil {
		c.JSON(http.StatusOK, gin.H{"code": 200, "message": "AK/SK does not exist"})
		return
	}
	if _, ok := all["ark"]; ok {
		delete(all, "ark")
		if len(all) == 0 {
			_ = os.Remove(path)
		} else {
			b, _ := json.MarshalIndent(all, "", "  ")
			_ = os.WriteFile(path, b, 0600)
		}
		c.JSON(http.StatusOK, gin.H{"code": 200, "message": "AK/SK deleted successfully"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "AK/SK does not exist"})
}

// Region list (can be extended to dynamic fetch)
func GetArkRegions(c *gin.Context) {
	regions := []string{"cn-beijing", "cn-shanghai", "ap-singapore"}
	c.JSON(http.StatusOK, gin.H{"code": 200, "regions": regions})
}

// Query model list (requires AK/SK)
func GetArkModels(c *gin.Context) {
	// Read AK/SK
	home, _ := os.UserHomeDir()
	path := filepath.Join(home, credFile)
	data, err := os.ReadFile(path)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "AK/SK not configured"})
		return
	}
	var all map[string]any
	_ = json.Unmarshal(data, &all)
	var cred ArkCredentials
	if v, ok := all["ark"]; ok {
		b, _ := json.Marshal(v)
		_ = json.Unmarshal(b, &cred)
	}
	if cred.AK == "" || cred.SK == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "AK/SK configuration invalid"})
		return
	}

	// Get endpoint parameter
	endpoint := c.Query("endpoint")
	//if endpoint == "" {
	//	endpoint = "ark.cn-beijing.volcengineapi.com"
	//}

	config := volcengine.NewConfig().
		WithEndpoint(endpoint).
		WithRegion("cn-beijing").
		WithLogger(volcengine.NewDefaultLogger()).
		WithLogLevel(volcengine.LogDebugAll).
		WithAkSk(cred.AK, cred.SK)
	sess, err := session.NewSession(config)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Session creation failed", "detail": err.Error()})
		return
	}
	svc := ark.New(sess)

	// Support pagination parameters
	pageNumber := 1
	pageSize := 20
	if pn := c.Query("pageNumber"); pn != "" {
		if v, err := strconv.Atoi(pn); err == nil {
			pageNumber = v
		}
	}
	if ps := c.Query("pageSize"); ps != "" {
		if v, err := strconv.Atoi(ps); err == nil {
			pageSize = v
		}
	}
	input := &ListFoundationModelsInput{
		PageNumber: pageNumber,
		PageSize:   pageSize,
	}

	output, err := ListFoundationModels(svc, input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Failed to obtain model list", "detail": err.Error()})
		return
	}

	metadata := make(map[string]interface{})
	if output.Metadata != nil {
		metadata["region"] = output.Metadata.Region
	}
	c.JSON(http.StatusOK, gin.H{
		"metadata":   metadata,
		"code":       200,
		"models":     output.Items,
		"total":      output.TotalCount,
		"pageNumber": output.PageNumber,
		"pageSize":   output.PageSize,
	})
}

// ARK SDK wrapper ListFoundationModels
func ListFoundationModels(svc *ark.ARK, input *ListFoundationModelsInput) (*ListFoundationModelsOutput, error) {
	// ark.NewRequest(opName string, input, output interface{})
	op := &request.Operation{
		Name:       opListFoundationModels,
		HTTPMethod: "POST",
		HTTPPath:   "/",
	}
	req := svc.NewRequest(op, input, &ListFoundationModelsOutput{})
	req.HTTPRequest.Header.Set("Content-Type", "application/json; charset=utf-8")

	output := req.Data.(*ListFoundationModelsOutput)
	return output, req.Send()
}

// Route registration
func RegisterArkProviderRoutes(r *gin.Engine) {
	r.GET("/api/models/provider/ark/credentials", GetArkCredentials)
	r.POST("/api/models/provider/ark/credentials", SetArkCredentials)
	r.DELETE("/api/models/provider/ark/credentials", DeleteArkCredentials)
	r.GET("/api/models/provider/ark/regions", GetArkRegions)
	r.GET("/api/models/provider/ark/models", GetArkModels)
}
