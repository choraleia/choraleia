package service

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Task types are free-form strings.

type TaskType string

type TaskStatus string

const (
	TaskStatusQueued    TaskStatus = "queued"
	TaskStatusRunning   TaskStatus = "running"
	TaskStatusSucceeded TaskStatus = "succeeded"
	TaskStatusFailed    TaskStatus = "failed"
	TaskStatusCanceled  TaskStatus = "canceled"
)

type TaskProgress struct {
	Total int64  `json:"total"`
	Done  int64  `json:"done"`
	Unit  string `json:"unit"` // e.g. "files" or "bytes"
	Note  string `json:"note"`
}

type Task struct {
	ID        string       `json:"id"`
	Type      TaskType     `json:"type"`
	Status    TaskStatus   `json:"status"`
	Title     string       `json:"title"`
	CreatedAt time.Time    `json:"created_at"`
	StartedAt *time.Time   `json:"started_at,omitempty"`
	EndedAt   *time.Time   `json:"ended_at,omitempty"`
	Progress  TaskProgress `json:"progress"`
	Error     string       `json:"error,omitempty"`
	Meta      any          `json:"meta,omitempty"`
}

type TaskSnapshot struct {
	Task
}

type TaskEventType string

const (
	TaskEventAdded    TaskEventType = "ADDED"
	TaskEventModified TaskEventType = "MODIFIED"
	TaskEventDeleted  TaskEventType = "DELETED"
)

type TaskWatchEvent struct {
	Type            TaskEventType `json:"type"`
	ResourceVersion uint64        `json:"resourceVersion"`
	Task            Task          `json:"task"`
}

type TaskListSnapshot struct {
	ResourceVersion uint64 `json:"resourceVersion"`
	Active          []Task `json:"active"`
	History         []Task `json:"history"`
}

type taskEventRecord struct {
	rv    uint64
	event TaskWatchEvent
}

type taskRuntime struct {
	task   *Task
	ctx    context.Context
	cancel context.CancelFunc
}

type TaskRunner func(ctx context.Context, update func(TaskProgress), setNote func(string)) error

type TaskService struct {
	mu sync.Mutex

	maxWorkers int
	queue      []*taskRuntime
	running    map[string]*taskRuntime
	history    []*Task

	subscribers map[chan TaskSnapshot]struct{}

	resourceVersion uint64
	events          []taskEventRecord
	maxEvents       int

	watchSubscribers map[chan TaskWatchEvent]struct{}
}

func NewTaskService(maxWorkers int) *TaskService {
	if maxWorkers <= 0 {
		maxWorkers = 2
	}
	return &TaskService{
		maxWorkers:       maxWorkers,
		running:          make(map[string]*taskRuntime),
		subscribers:      make(map[chan TaskSnapshot]struct{}),
		watchSubscribers: make(map[chan TaskWatchEvent]struct{}),
		maxEvents:        2048,
	}
}

// NewTaskService constructs the in-memory task manager used by background jobs.
// It is referenced from router setup.
var _ = NewTaskService

func (s *TaskService) Enqueue(tt TaskType, title string, meta any, runner TaskRunner) *Task {
	s.mu.Lock()
	defer s.mu.Unlock()

	id := uuid.NewString()
	now := time.Now()
	t := &Task{
		ID:        id,
		Type:      tt,
		Status:    TaskStatusQueued,
		Title:     title,
		CreatedAt: now,
		Progress:  TaskProgress{Total: 0, Done: 0, Unit: "", Note: ""},
		Meta:      meta,
	}

	ctx, cancel := context.WithCancel(context.Background())
	rt := &taskRuntime{task: t, ctx: ctx, cancel: cancel}
	s.queue = append(s.queue, rt)
	s.broadcastLocked(*t)
	s.broadcastWatchLocked(TaskEventAdded, *t)

	go s.maybeStartWorkers(runner)
	return t
}

func (s *TaskService) maybeStartWorkers(runner TaskRunner) {
	for {
		s.mu.Lock()
		if len(s.running) >= s.maxWorkers || len(s.queue) == 0 {
			s.mu.Unlock()
			return
		}

		rt := s.queue[0]
		s.queue = s.queue[1:]

		now := time.Now()
		rt.task.Status = TaskStatusRunning
		rt.task.StartedAt = &now
		s.running[rt.task.ID] = rt
		s.broadcastLocked(*rt.task)
		s.broadcastWatchLocked(TaskEventModified, *rt.task)
		s.mu.Unlock()

		// Run task
		err := runner(rt.ctx,
			func(p TaskProgress) {
				s.mu.Lock()
				rt.task.Progress = p
				s.broadcastLocked(*rt.task)
				s.broadcastWatchLocked(TaskEventModified, *rt.task)
				s.mu.Unlock()
			},
			func(note string) {
				s.mu.Lock()
				rt.task.Progress.Note = note
				s.broadcastLocked(*rt.task)
				s.broadcastWatchLocked(TaskEventModified, *rt.task)
				s.mu.Unlock()
			},
		)

		s.mu.Lock()
		delete(s.running, rt.task.ID)

		end := time.Now()
		rt.task.EndedAt = &end

		if errors.Is(err, context.Canceled) {
			rt.task.Status = TaskStatusCanceled
			if rt.task.Error == "" {
				rt.task.Error = "canceled"
			}
		} else if err != nil {
			rt.task.Status = TaskStatusFailed
			rt.task.Error = err.Error()
		} else {
			rt.task.Status = TaskStatusSucceeded
		}

		s.history = append([]*Task{rt.task}, s.history...)
		if len(s.history) > 200 {
			s.history = s.history[:200]
		}
		s.broadcastLocked(*rt.task)
		s.broadcastWatchLocked(TaskEventModified, *rt.task)
		s.mu.Unlock()
	}
}

func (s *TaskService) ListRunning() []Task {
	s.mu.Lock()
	defer s.mu.Unlock()

	out := make([]Task, 0, len(s.queue)+len(s.running))
	for _, rt := range s.queue {
		out = append(out, *rt.task)
	}
	for _, rt := range s.running {
		out = append(out, *rt.task)
	}
	return out
}

func (s *TaskService) ListHistory(limit int) []Task {
	s.mu.Lock()
	defer s.mu.Unlock()
	if limit <= 0 || limit > len(s.history) {
		limit = len(s.history)
	}
	out := make([]Task, 0, limit)
	for i := 0; i < limit; i++ {
		out = append(out, *s.history[i])
	}
	return out
}

func (s *TaskService) Cancel(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// queued
	for i, rt := range s.queue {
		if rt.task.ID == id {
			rt.cancel()
			now := time.Now()
			rt.task.Status = TaskStatusCanceled
			rt.task.EndedAt = &now
			s.queue = append(s.queue[:i], s.queue[i+1:]...)
			s.history = append([]*Task{rt.task}, s.history...)
			s.broadcastLocked(*rt.task)
			s.broadcastWatchLocked(TaskEventModified, *rt.task)
			return nil
		}
	}

	if rt, ok := s.running[id]; ok {
		rt.cancel()
		s.broadcastLocked(*rt.task)
		s.broadcastWatchLocked(TaskEventModified, *rt.task)
		return nil
	}

	return errors.New("task not found")
}

// ListSnapshot returns a full snapshot of the task store.
// It is used for list-watch semantics over WebSocket.
func (s *TaskService) ListSnapshot(historyLimit int) TaskListSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()

	active := make([]Task, 0, len(s.queue)+len(s.running))
	for _, rt := range s.queue {
		active = append(active, *rt.task)
	}
	for _, rt := range s.running {
		active = append(active, *rt.task)
	}

	limit := historyLimit
	if limit <= 0 {
		limit = 50
	}
	if limit > len(s.history) {
		limit = len(s.history)
	}
	history := make([]Task, 0, limit)
	for i := 0; i < limit; i++ {
		history = append(history, *s.history[i])
	}

	return TaskListSnapshot{ResourceVersion: s.resourceVersion, Active: active, History: history}
}

// ResourceVersion returns the latest monotonically increasing version for the task store.
func (s *TaskService) ResourceVersion() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.resourceVersion
}

// SubscribeWatch starts a watch stream for task changes.
// It optionally replays buffered events strictly newer than sinceRV.
// If the caller needs a full consistent view, it should call ListSnapshot first.
func (s *TaskService) SubscribeWatch(sinceRV uint64) (ch <-chan TaskWatchEvent, cancel func(), startRV uint64, ok bool) {
	c := make(chan TaskWatchEvent, 256)

	s.mu.Lock()
	defer s.mu.Unlock()

	startRV = s.resourceVersion
	ok = true

	// Replay buffered events newer than sinceRV.
	if sinceRV > 0 {
		if len(s.events) == 0 {
			ok = false
		} else {
			oldest := s.events[0].rv
			if sinceRV < oldest {
				ok = false
			} else {
				for _, rec := range s.events {
					if rec.rv > sinceRV {
						select {
						case c <- rec.event:
						default:
							// drop replay if buffer is full
						}
					}
				}
			}
		}
	}

	s.watchSubscribers[c] = struct{}{}

	cancelFn := func() {
		s.mu.Lock()
		delete(s.watchSubscribers, c)
		close(c)
		s.mu.Unlock()
	}

	return c, cancelFn, startRV, ok
}

func (s *TaskService) Subscribe() (ch <-chan TaskSnapshot, cancel func()) {
	c := make(chan TaskSnapshot, 32)
	cancelFn := func() {
		s.mu.Lock()
		delete(s.subscribers, c)
		close(c)
		s.mu.Unlock()
	}

	s.mu.Lock()
	s.subscribers[c] = struct{}{}
	s.mu.Unlock()

	return c, cancelFn
}

func (s *TaskService) broadcastLocked(t Task) {
	snap := TaskSnapshot{Task: t}
	for ch := range s.subscribers {
		select {
		case ch <- snap:
		default:
			// drop
		}
	}
}

func (s *TaskService) broadcastWatchLocked(evType TaskEventType, t Task) {
	// Monotonic resource version.
	s.resourceVersion++
	rv := s.resourceVersion

	ev := TaskWatchEvent{Type: evType, ResourceVersion: rv, Task: t}

	// Append to ring buffer.
	s.events = append(s.events, taskEventRecord{rv: rv, event: ev})
	if s.maxEvents <= 0 {
		s.maxEvents = 2048
	}
	if len(s.events) > s.maxEvents {
		s.events = s.events[len(s.events)-s.maxEvents:]
	}

	for ch := range s.watchSubscribers {
		select {
		case ch <- ev:
		default:
			// drop
		}
	}
}
