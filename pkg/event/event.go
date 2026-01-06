// Package event provides a lightweight notification system inspired by VS Code.
//
// Design principles:
// - Events are notifications only, no data payload
// - Each event type is a separate Go type for type safety
// - Clients call HTTP APIs to fetch actual data after receiving notifications
// - Use Delayer/Sequencer on client side to handle race conditions
package event

import (
	"log"
	"sync"
)

// Event is the interface all event types must implement.
type Event interface {
	// EventName returns the unique name for this event type (e.g., "fs.changed")
	EventName() string
}

// Listener is a callback function for handling events.
type Listener func(Event)

// Emitter manages event subscriptions and dispatching.
type Emitter struct {
	mu           sync.RWMutex
	listeners    map[string][]Listener // eventName -> listeners
	allListeners []Listener            // listeners for all events
}

// NewEmitter creates a new event emitter.
func NewEmitter() *Emitter {
	return &Emitter{
		listeners: make(map[string][]Listener),
	}
}

// On subscribes to a specific event type.
// Returns an unsubscribe function.
func (e *Emitter) On(eventName string, fn Listener) func() {
	e.mu.Lock()
	e.listeners[eventName] = append(e.listeners[eventName], fn)
	e.mu.Unlock()

	return func() {
		e.mu.Lock()
		defer e.mu.Unlock()
		listeners := e.listeners[eventName]
		for i, l := range listeners {
			// Compare function pointers
			if &l == &fn {
				e.listeners[eventName] = append(listeners[:i], listeners[i+1:]...)
				break
			}
		}
	}
}

// OnAny subscribes to all events.
func (e *Emitter) OnAny(fn Listener) func() {
	e.mu.Lock()
	e.allListeners = append(e.allListeners, fn)
	e.mu.Unlock()

	return func() {
		e.mu.Lock()
		defer e.mu.Unlock()
		for i, l := range e.allListeners {
			if &l == &fn {
				e.allListeners = append(e.allListeners[:i], e.allListeners[i+1:]...)
				break
			}
		}
	}
}

// Emit dispatches an event to all matching listeners.
func (e *Emitter) Emit(ev Event) {
	e.mu.RLock()
	// Copy listeners to avoid holding lock during callbacks
	specific := make([]Listener, len(e.listeners[ev.EventName()]))
	copy(specific, e.listeners[ev.EventName()])
	all := make([]Listener, len(e.allListeners))
	copy(all, e.allListeners)
	e.mu.RUnlock()

	// Debug log
	log.Printf("[Event] Emitting %s to %d specific + %d wildcard listeners", ev.EventName(), len(specific), len(all))

	// Dispatch to specific listeners
	for _, fn := range specific {
		fn(ev)
	}
	// Dispatch to wildcard listeners
	for _, fn := range all {
		fn(ev)
	}
}

// ---- Global Emitter ----

var globalEmitter *Emitter
var globalOnce sync.Once

// Global returns the global event emitter.
func Global() *Emitter {
	globalOnce.Do(func() {
		globalEmitter = NewEmitter()
	})
	return globalEmitter
}

// Emit is a shortcut for Global().Emit(ev).
func Emit(ev Event) {
	Global().Emit(ev)
}

// On is a shortcut for Global().On(eventName, fn).
func On(eventName string, fn Listener) func() {
	return Global().On(eventName, fn)
}
