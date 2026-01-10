package service

import "testing"

func TestShellQuoteArgs(t *testing.T) {
	tests := []struct {
		name     string
		cmd      []string
		expected string
	}{
		{
			name:     "simple command",
			cmd:      []string{"ls", "-la"},
			expected: "ls -la",
		},
		{
			name:     "command with semicolon in arg",
			cmd:      []string{"./script.sh", "arg;with;semicolon"},
			expected: "./script.sh 'arg;with;semicolon'",
		},
		{
			name:     "command with spaces in arg",
			cmd:      []string{"echo", "hello world"},
			expected: "echo 'hello world'",
		},
		{
			name:     "command with single quote in arg",
			cmd:      []string{"echo", "it's working"},
			expected: "echo 'it'\"'\"'s working'",
		},
		{
			name:     "command with dollar sign",
			cmd:      []string{"echo", "$HOME"},
			expected: "echo '$HOME'",
		},
		{
			name:     "command with backtick",
			cmd:      []string{"echo", "`whoami`"},
			expected: "echo '`whoami`'",
		},
		{
			name:     "command with pipe",
			cmd:      []string{"grep", "foo|bar"},
			expected: "grep 'foo|bar'",
		},
		{
			name:     "empty command",
			cmd:      []string{},
			expected: "",
		},
		{
			name:     "mixed safe and unsafe args",
			cmd:      []string{"./test.sh", "safe", "unsafe;arg", "also-safe"},
			expected: "./test.sh safe 'unsafe;arg' also-safe",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := shellQuoteArgs(tt.cmd)
			if result != tt.expected {
				t.Errorf("shellQuoteArgs(%v) = %q, want %q", tt.cmd, result, tt.expected)
			}
		})
	}
}
