// Package database provides database tools for AI agents.
// These tools enable AI to query and manage MySQL, PostgreSQL, and Redis databases.
package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/schema"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/lib/pq"

	"github.com/choraleia/choraleia/pkg/tools"
)

func init() {
	// MySQL tools
	tools.Register(tools.ToolDefinition{
		ID:          "mysql_query",
		Name:        "MySQL Query",
		Description: "Execute a read-only SQL query on a MySQL database",
		Category:    tools.CategoryDatabase,
		Scope:       tools.ScopeGlobal,
		Dangerous:   false,
	}, NewMySQLQueryTool)

	tools.Register(tools.ToolDefinition{
		ID:          "mysql_execute",
		Name:        "MySQL Execute",
		Description: "Execute a SQL statement (INSERT/UPDATE/DELETE) on a MySQL database",
		Category:    tools.CategoryDatabase,
		Scope:       tools.ScopeGlobal,
		Dangerous:   true,
	}, NewMySQLExecuteTool)

	tools.Register(tools.ToolDefinition{
		ID:          "mysql_schema",
		Name:        "MySQL Schema",
		Description: "Get database schema information from MySQL",
		Category:    tools.CategoryDatabase,
		Scope:       tools.ScopeGlobal,
		Dangerous:   false,
	}, NewMySQLSchemaTool)

	// PostgreSQL tools
	tools.Register(tools.ToolDefinition{
		ID:          "postgres_query",
		Name:        "PostgreSQL Query",
		Description: "Execute a read-only SQL query on a PostgreSQL database",
		Category:    tools.CategoryDatabase,
		Scope:       tools.ScopeGlobal,
		Dangerous:   false,
	}, NewPostgresQueryTool)

	tools.Register(tools.ToolDefinition{
		ID:          "postgres_execute",
		Name:        "PostgreSQL Execute",
		Description: "Execute a SQL statement (INSERT/UPDATE/DELETE) on a PostgreSQL database",
		Category:    tools.CategoryDatabase,
		Scope:       tools.ScopeGlobal,
		Dangerous:   true,
	}, NewPostgresExecuteTool)

	tools.Register(tools.ToolDefinition{
		ID:          "postgres_schema",
		Name:        "PostgreSQL Schema",
		Description: "Get database schema information from PostgreSQL",
		Category:    tools.CategoryDatabase,
		Scope:       tools.ScopeGlobal,
		Dangerous:   false,
	}, NewPostgresSchemaTool)

	// Redis tools
	tools.Register(tools.ToolDefinition{
		ID:          "redis_command",
		Name:        "Redis Command",
		Description: "Execute a Redis command",
		Category:    tools.CategoryDatabase,
		Scope:       tools.ScopeGlobal,
		Dangerous:   true, // Redis commands can modify data
	}, NewRedisCommandTool)

	tools.Register(tools.ToolDefinition{
		ID:          "redis_keys",
		Name:        "Redis Keys",
		Description: "List Redis keys matching a pattern",
		Category:    tools.CategoryDatabase,
		Scope:       tools.ScopeGlobal,
		Dangerous:   false,
	}, NewRedisKeysTool)
}

// ==================== MySQL Tools ====================

type MySQLQueryInput struct {
	Host     string `json:"host"`
	Port     int    `json:"port,omitempty"`
	Database string `json:"database"`
	Username string `json:"username"`
	Password string `json:"password,omitempty"`
	Query    string `json:"query"`
	Limit    int    `json:"limit,omitempty"`
}

func NewMySQLQueryTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "mysql_query",
		Desc: "Execute a read-only SQL query on a MySQL database. Returns results as JSON. Only SELECT queries are allowed.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"host":     {Type: schema.String, Required: true, Desc: "MySQL server host"},
			"port":     {Type: schema.Integer, Required: false, Desc: "MySQL server port (default: 3306)"},
			"database": {Type: schema.String, Required: true, Desc: "Database name"},
			"username": {Type: schema.String, Required: true, Desc: "Database username"},
			"password": {Type: schema.String, Required: false, Desc: "Database password"},
			"query":    {Type: schema.String, Required: true, Desc: "SQL SELECT query to execute"},
			"limit":    {Type: schema.Integer, Required: false, Desc: "Maximum rows to return (default: 100)"},
		}),
	}, func(ctx context.Context, input *MySQLQueryInput) (string, error) {
		// Validate query is read-only
		queryUpper := strings.ToUpper(strings.TrimSpace(input.Query))
		if !strings.HasPrefix(queryUpper, "SELECT") && !strings.HasPrefix(queryUpper, "SHOW") && !strings.HasPrefix(queryUpper, "DESCRIBE") && !strings.HasPrefix(queryUpper, "EXPLAIN") {
			return fmt.Sprintf("Error: only SELECT, SHOW, DESCRIBE, and EXPLAIN queries are allowed"), nil
		}

		port := input.Port
		if port <= 0 {
			port = 3306
		}

		limit := input.Limit
		if limit <= 0 {
			limit = 100
		}

		// Connect to MySQL
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true&timeout=10s",
			input.Username, input.Password, input.Host, port, input.Database)

		db, err := sql.Open("mysql", dsn)
		if err != nil {
			return fmt.Sprintf("Error: failed to connect: %v", err), nil
		}
		defer db.Close()

		db.SetConnMaxLifetime(30 * time.Second)
		db.SetMaxOpenConns(1)

		// Execute query with limit
		query := input.Query
		if !strings.Contains(strings.ToUpper(query), "LIMIT") {
			query = fmt.Sprintf("%s LIMIT %d", query, limit)
		}

		rows, err := db.QueryContext(ctx, query)
		if err != nil {
			return fmt.Sprintf("Error: query failed: %v", err), nil
		}
		defer rows.Close()

		// Get column names
		columns, err := rows.Columns()
		if err != nil {
			return fmt.Sprintf("Error: failed to get columns: %v", err), nil
		}

		// Fetch results
		results := make([]map[string]interface{}, 0)
		for rows.Next() {
			values := make([]interface{}, len(columns))
			valuePtrs := make([]interface{}, len(columns))
			for i := range columns {
				valuePtrs[i] = &values[i]
			}

			if err := rows.Scan(valuePtrs...); err != nil {
				return fmt.Sprintf("Error: failed to scan row: %v", err), nil
			}

			row := make(map[string]interface{})
			for i, col := range columns {
				val := values[i]
				if b, ok := val.([]byte); ok {
					row[col] = string(b)
				} else {
					row[col] = val
				}
			}
			results = append(results, row)
		}

		// Format output
		output := map[string]interface{}{
			"database": input.Database,
			"query":    input.Query,
			"columns":  columns,
			"rows":     len(results),
			"data":     results,
		}

		data, _ := json.MarshalIndent(output, "", "  ")
		return string(data), nil
	})
}

type MySQLExecuteInput struct {
	Host      string `json:"host"`
	Port      int    `json:"port,omitempty"`
	Database  string `json:"database"`
	Username  string `json:"username"`
	Password  string `json:"password,omitempty"`
	Statement string `json:"statement"`
}

func NewMySQLExecuteTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "mysql_execute",
		Desc: "Execute a SQL statement (INSERT/UPDATE/DELETE) on a MySQL database. Use with caution.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"host":      {Type: schema.String, Required: true, Desc: "MySQL server host"},
			"port":      {Type: schema.Integer, Required: false, Desc: "MySQL server port (default: 3306)"},
			"database":  {Type: schema.String, Required: true, Desc: "Database name"},
			"username":  {Type: schema.String, Required: true, Desc: "Database username"},
			"password":  {Type: schema.String, Required: false, Desc: "Database password"},
			"statement": {Type: schema.String, Required: true, Desc: "SQL statement to execute"},
		}),
	}, func(ctx context.Context, input *MySQLExecuteInput) (string, error) {
		port := input.Port
		if port <= 0 {
			port = 3306
		}

		dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true&timeout=10s",
			input.Username, input.Password, input.Host, port, input.Database)

		db, err := sql.Open("mysql", dsn)
		if err != nil {
			return fmt.Sprintf("Error: failed to connect: %v", err), nil
		}
		defer db.Close()

		result, err := db.ExecContext(ctx, input.Statement)
		if err != nil {
			return fmt.Sprintf("Error: statement failed: %v", err), nil
		}

		rowsAffected, _ := result.RowsAffected()
		lastInsertId, _ := result.LastInsertId()

		output := map[string]interface{}{
			"database":       input.Database,
			"statement":      input.Statement,
			"rows_affected":  rowsAffected,
			"last_insert_id": lastInsertId,
		}

		data, _ := json.MarshalIndent(output, "", "  ")
		return string(data), nil
	})
}

type MySQLSchemaInput struct {
	Host     string `json:"host"`
	Port     int    `json:"port,omitempty"`
	Database string `json:"database"`
	Username string `json:"username"`
	Password string `json:"password,omitempty"`
	Table    string `json:"table,omitempty"`
}

func NewMySQLSchemaTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "mysql_schema",
		Desc: "Get database schema information from MySQL. Lists tables or describes a specific table's columns.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"host":     {Type: schema.String, Required: true, Desc: "MySQL server host"},
			"port":     {Type: schema.Integer, Required: false, Desc: "MySQL server port (default: 3306)"},
			"database": {Type: schema.String, Required: true, Desc: "Database name"},
			"username": {Type: schema.String, Required: true, Desc: "Database username"},
			"password": {Type: schema.String, Required: false, Desc: "Database password"},
			"table":    {Type: schema.String, Required: false, Desc: "Table name (if omitted, lists all tables)"},
		}),
	}, func(ctx context.Context, input *MySQLSchemaInput) (string, error) {
		port := input.Port
		if port <= 0 {
			port = 3306
		}

		dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true&timeout=10s",
			input.Username, input.Password, input.Host, port, input.Database)

		db, err := sql.Open("mysql", dsn)
		if err != nil {
			return fmt.Sprintf("Error: failed to connect: %v", err), nil
		}
		defer db.Close()

		var query string
		if input.Table == "" {
			query = "SHOW TABLES"
		} else {
			query = fmt.Sprintf("DESCRIBE `%s`", input.Table)
		}

		rows, err := db.QueryContext(ctx, query)
		if err != nil {
			return fmt.Sprintf("Error: query failed: %v", err), nil
		}
		defer rows.Close()

		columns, _ := rows.Columns()
		results := make([]map[string]interface{}, 0)

		for rows.Next() {
			values := make([]interface{}, len(columns))
			valuePtrs := make([]interface{}, len(columns))
			for i := range columns {
				valuePtrs[i] = &values[i]
			}

			if err := rows.Scan(valuePtrs...); err != nil {
				continue
			}

			row := make(map[string]interface{})
			for i, col := range columns {
				val := values[i]
				if b, ok := val.([]byte); ok {
					row[col] = string(b)
				} else {
					row[col] = val
				}
			}
			results = append(results, row)
		}

		output := map[string]interface{}{
			"database": input.Database,
			"table":    input.Table,
			"schema":   results,
		}

		data, _ := json.MarshalIndent(output, "", "  ")
		return string(data), nil
	})
}

// ==================== PostgreSQL Tools ====================

type PostgresQueryInput struct {
	Host     string `json:"host"`
	Port     int    `json:"port,omitempty"`
	Database string `json:"database"`
	Username string `json:"username"`
	Password string `json:"password,omitempty"`
	SSLMode  string `json:"ssl_mode,omitempty"`
	Query    string `json:"query"`
	Limit    int    `json:"limit,omitempty"`
}

func NewPostgresQueryTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "postgres_query",
		Desc: "Execute a read-only SQL query on a PostgreSQL database. Returns results as JSON. Only SELECT queries are allowed.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"host":     {Type: schema.String, Required: true, Desc: "PostgreSQL server host"},
			"port":     {Type: schema.Integer, Required: false, Desc: "PostgreSQL server port (default: 5432)"},
			"database": {Type: schema.String, Required: true, Desc: "Database name"},
			"username": {Type: schema.String, Required: true, Desc: "Database username"},
			"password": {Type: schema.String, Required: false, Desc: "Database password"},
			"ssl_mode": {Type: schema.String, Required: false, Desc: "SSL mode (disable, require, verify-ca, verify-full)"},
			"query":    {Type: schema.String, Required: true, Desc: "SQL SELECT query to execute"},
			"limit":    {Type: schema.Integer, Required: false, Desc: "Maximum rows to return (default: 100)"},
		}),
	}, func(ctx context.Context, input *PostgresQueryInput) (string, error) {
		// Validate query is read-only
		queryUpper := strings.ToUpper(strings.TrimSpace(input.Query))
		if !strings.HasPrefix(queryUpper, "SELECT") && !strings.HasPrefix(queryUpper, "SHOW") && !strings.HasPrefix(queryUpper, "EXPLAIN") {
			return fmt.Sprintf("Error: only SELECT, SHOW, and EXPLAIN queries are allowed"), nil
		}

		port := input.Port
		if port <= 0 {
			port = 5432
		}

		limit := input.Limit
		if limit <= 0 {
			limit = 100
		}

		sslMode := input.SSLMode
		if sslMode == "" {
			sslMode = "disable"
		}

		// Connect to PostgreSQL
		dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s connect_timeout=10",
			input.Host, port, input.Username, input.Password, input.Database, sslMode)

		db, err := sql.Open("postgres", dsn)
		if err != nil {
			return fmt.Sprintf("Error: failed to connect: %v", err), nil
		}
		defer db.Close()

		// Execute query with limit
		query := input.Query
		if !strings.Contains(strings.ToUpper(query), "LIMIT") {
			query = fmt.Sprintf("%s LIMIT %d", query, limit)
		}

		rows, err := db.QueryContext(ctx, query)
		if err != nil {
			return fmt.Sprintf("Error: query failed: %v", err), nil
		}
		defer rows.Close()

		columns, _ := rows.Columns()
		results := make([]map[string]interface{}, 0)

		for rows.Next() {
			values := make([]interface{}, len(columns))
			valuePtrs := make([]interface{}, len(columns))
			for i := range columns {
				valuePtrs[i] = &values[i]
			}

			if err := rows.Scan(valuePtrs...); err != nil {
				continue
			}

			row := make(map[string]interface{})
			for i, col := range columns {
				val := values[i]
				if b, ok := val.([]byte); ok {
					row[col] = string(b)
				} else {
					row[col] = val
				}
			}
			results = append(results, row)
		}

		output := map[string]interface{}{
			"database": input.Database,
			"query":    input.Query,
			"columns":  columns,
			"rows":     len(results),
			"data":     results,
		}

		data, _ := json.MarshalIndent(output, "", "  ")
		return string(data), nil
	})
}

type PostgresExecuteInput struct {
	Host      string `json:"host"`
	Port      int    `json:"port,omitempty"`
	Database  string `json:"database"`
	Username  string `json:"username"`
	Password  string `json:"password,omitempty"`
	SSLMode   string `json:"ssl_mode,omitempty"`
	Statement string `json:"statement"`
}

func NewPostgresExecuteTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "postgres_execute",
		Desc: "Execute a SQL statement (INSERT/UPDATE/DELETE) on a PostgreSQL database. Use with caution.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"host":      {Type: schema.String, Required: true, Desc: "PostgreSQL server host"},
			"port":      {Type: schema.Integer, Required: false, Desc: "PostgreSQL server port (default: 5432)"},
			"database":  {Type: schema.String, Required: true, Desc: "Database name"},
			"username":  {Type: schema.String, Required: true, Desc: "Database username"},
			"password":  {Type: schema.String, Required: false, Desc: "Database password"},
			"ssl_mode":  {Type: schema.String, Required: false, Desc: "SSL mode"},
			"statement": {Type: schema.String, Required: true, Desc: "SQL statement to execute"},
		}),
	}, func(ctx context.Context, input *PostgresExecuteInput) (string, error) {
		port := input.Port
		if port <= 0 {
			port = 5432
		}

		sslMode := input.SSLMode
		if sslMode == "" {
			sslMode = "disable"
		}

		dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s connect_timeout=10",
			input.Host, port, input.Username, input.Password, input.Database, sslMode)

		db, err := sql.Open("postgres", dsn)
		if err != nil {
			return fmt.Sprintf("Error: failed to connect: %v", err), nil
		}
		defer db.Close()

		result, err := db.ExecContext(ctx, input.Statement)
		if err != nil {
			return fmt.Sprintf("Error: statement failed: %v", err), nil
		}

		rowsAffected, _ := result.RowsAffected()

		output := map[string]interface{}{
			"database":      input.Database,
			"statement":     input.Statement,
			"rows_affected": rowsAffected,
		}

		data, _ := json.MarshalIndent(output, "", "  ")
		return string(data), nil
	})
}

type PostgresSchemaInput struct {
	Host     string `json:"host"`
	Port     int    `json:"port,omitempty"`
	Database string `json:"database"`
	Username string `json:"username"`
	Password string `json:"password,omitempty"`
	SSLMode  string `json:"ssl_mode,omitempty"`
	Schema   string `json:"schema,omitempty"`
	Table    string `json:"table,omitempty"`
}

func NewPostgresSchemaTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "postgres_schema",
		Desc: "Get database schema information from PostgreSQL. Lists tables or describes a specific table's columns.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"host":     {Type: schema.String, Required: true, Desc: "PostgreSQL server host"},
			"port":     {Type: schema.Integer, Required: false, Desc: "PostgreSQL server port (default: 5432)"},
			"database": {Type: schema.String, Required: true, Desc: "Database name"},
			"username": {Type: schema.String, Required: true, Desc: "Database username"},
			"password": {Type: schema.String, Required: false, Desc: "Database password"},
			"ssl_mode": {Type: schema.String, Required: false, Desc: "SSL mode"},
			"schema":   {Type: schema.String, Required: false, Desc: "Schema name (default: public)"},
			"table":    {Type: schema.String, Required: false, Desc: "Table name (if omitted, lists all tables)"},
		}),
	}, func(ctx context.Context, input *PostgresSchemaInput) (string, error) {
		port := input.Port
		if port <= 0 {
			port = 5432
		}

		sslMode := input.SSLMode
		if sslMode == "" {
			sslMode = "disable"
		}

		schemaName := input.Schema
		if schemaName == "" {
			schemaName = "public"
		}

		dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s connect_timeout=10",
			input.Host, port, input.Username, input.Password, input.Database, sslMode)

		db, err := sql.Open("postgres", dsn)
		if err != nil {
			return fmt.Sprintf("Error: failed to connect: %v", err), nil
		}
		defer db.Close()

		var query string
		if input.Table == "" {
			query = fmt.Sprintf(`SELECT table_name FROM information_schema.tables WHERE table_schema = '%s' ORDER BY table_name`, schemaName)
		} else {
			query = fmt.Sprintf(`SELECT column_name, data_type, is_nullable, column_default 
				FROM information_schema.columns 
				WHERE table_schema = '%s' AND table_name = '%s' 
				ORDER BY ordinal_position`, schemaName, input.Table)
		}

		rows, err := db.QueryContext(ctx, query)
		if err != nil {
			return fmt.Sprintf("Error: query failed: %v", err), nil
		}
		defer rows.Close()

		columns, _ := rows.Columns()
		results := make([]map[string]interface{}, 0)

		for rows.Next() {
			values := make([]interface{}, len(columns))
			valuePtrs := make([]interface{}, len(columns))
			for i := range columns {
				valuePtrs[i] = &values[i]
			}

			if err := rows.Scan(valuePtrs...); err != nil {
				continue
			}

			row := make(map[string]interface{})
			for i, col := range columns {
				val := values[i]
				if b, ok := val.([]byte); ok {
					row[col] = string(b)
				} else {
					row[col] = val
				}
			}
			results = append(results, row)
		}

		output := map[string]interface{}{
			"database": input.Database,
			"schema":   schemaName,
			"table":    input.Table,
			"data":     results,
		}

		data, _ := json.MarshalIndent(output, "", "  ")
		return string(data), nil
	})
}
