package models

// RuntimeInfo describes the backend runtime settings that the frontend may need.
// It is intentionally small and stable.
type RuntimeInfo struct {
	HTTPBaseURL string `json:"http_base_url"`
	WSBaseURL   string `json:"ws_base_url"`
	Port        int    `json:"port"`
}
