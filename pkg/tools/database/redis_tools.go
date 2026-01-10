package database

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/schema"
	"github.com/redis/go-redis/v9"

	"github.com/choraleia/choraleia/pkg/tools"
)

// ==================== Redis Tools ====================

type RedisCommandInput struct {
	Host     string   `json:"host"`
	Port     int      `json:"port,omitempty"`
	Password string   `json:"password,omitempty"`
	DB       int      `json:"db,omitempty"`
	Command  string   `json:"command"`
	Args     []string `json:"args,omitempty"`
}

func NewRedisCommandTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "redis_command",
		Desc: "Execute a Redis command. Supports GET, SET, HGET, HSET, LPUSH, RPUSH, LRANGE, SADD, SMEMBERS, etc.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"host":     {Type: schema.String, Required: true, Desc: "Redis server host"},
			"port":     {Type: schema.Integer, Required: false, Desc: "Redis server port (default: 6379)"},
			"password": {Type: schema.String, Required: false, Desc: "Redis password"},
			"db":       {Type: schema.Integer, Required: false, Desc: "Redis database number (default: 0)"},
			"command":  {Type: schema.String, Required: true, Desc: "Redis command (e.g., GET, SET, HGET)"},
			"args":     {Type: schema.Array, Required: false, Desc: "Command arguments", ElemInfo: &schema.ParameterInfo{Type: schema.String}},
		}),
	}, func(ctx context.Context, input *RedisCommandInput) (string, error) {
		port := input.Port
		if port <= 0 {
			port = 6379
		}

		// Create Redis client
		rdb := redis.NewClient(&redis.Options{
			Addr:        fmt.Sprintf("%s:%d", input.Host, port),
			Password:    input.Password,
			DB:          input.DB,
			DialTimeout: 10 * time.Second,
		})
		defer rdb.Close()

		// Build command args
		args := make([]interface{}, 0, len(input.Args)+1)
		args = append(args, input.Command)
		for _, arg := range input.Args {
			args = append(args, arg)
		}

		// Execute command
		result, err := rdb.Do(ctx, args...).Result()
		if err != nil {
			if err == redis.Nil {
				return "(nil)", nil
			}
			return "", fmt.Errorf("command failed: %w", err)
		}

		// Format result
		output := formatRedisResult(result)

		return fmt.Sprintf("Command: %s %s\nResult: %s", input.Command, strings.Join(input.Args, " "), output), nil
	})
}

type RedisKeysInput struct {
	Host     string `json:"host"`
	Port     int    `json:"port,omitempty"`
	Password string `json:"password,omitempty"`
	DB       int    `json:"db,omitempty"`
	Pattern  string `json:"pattern"`
	Limit    int    `json:"limit,omitempty"`
}

func NewRedisKeysTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "redis_keys",
		Desc: "List Redis keys matching a pattern. Uses SCAN for safe iteration.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"host":     {Type: schema.String, Required: true, Desc: "Redis server host"},
			"port":     {Type: schema.Integer, Required: false, Desc: "Redis server port (default: 6379)"},
			"password": {Type: schema.String, Required: false, Desc: "Redis password"},
			"db":       {Type: schema.Integer, Required: false, Desc: "Redis database number (default: 0)"},
			"pattern":  {Type: schema.String, Required: true, Desc: "Key pattern (e.g., 'user:*', 'session:*')"},
			"limit":    {Type: schema.Integer, Required: false, Desc: "Maximum keys to return (default: 100)"},
		}),
	}, func(ctx context.Context, input *RedisKeysInput) (string, error) {
		port := input.Port
		if port <= 0 {
			port = 6379
		}

		limit := input.Limit
		if limit <= 0 {
			limit = 100
		}

		// Create Redis client
		rdb := redis.NewClient(&redis.Options{
			Addr:        fmt.Sprintf("%s:%d", input.Host, port),
			Password:    input.Password,
			DB:          input.DB,
			DialTimeout: 10 * time.Second,
		})
		defer rdb.Close()

		// Use SCAN to iterate keys
		var keys []string
		var cursor uint64
		for {
			var batch []string
			var err error
			batch, cursor, err = rdb.Scan(ctx, cursor, input.Pattern, int64(limit)).Result()
			if err != nil {
				return "", fmt.Errorf("scan failed: %w", err)
			}

			keys = append(keys, batch...)
			if len(keys) >= limit || cursor == 0 {
				break
			}
		}

		if len(keys) > limit {
			keys = keys[:limit]
		}

		output := map[string]interface{}{
			"pattern": input.Pattern,
			"count":   len(keys),
			"keys":    keys,
		}

		data, _ := json.MarshalIndent(output, "", "  ")
		return string(data), nil
	})
}

// formatRedisResult formats Redis result for display
func formatRedisResult(result interface{}) string {
	switch v := result.(type) {
	case string:
		return fmt.Sprintf("\"%s\"", v)
	case int64:
		return fmt.Sprintf("%d", v)
	case []interface{}:
		items := make([]string, len(v))
		for i, item := range v {
			items[i] = formatRedisResult(item)
		}
		return fmt.Sprintf("[%s]", strings.Join(items, ", "))
	case nil:
		return "(nil)"
	default:
		data, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		return string(data)
	}
}
