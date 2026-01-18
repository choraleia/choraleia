package service

// Shared network configuration for all choraleia containers
const (
	// ChoraNetworkName is the Docker network used by all choraleia containers
	// Both workspace containers and browser containers will use this network
	// to enable inter-container communication
	ChoraNetworkName = "choraleia-net"
)
