# Event System Design

## Overview

A lightweight event notification system inspired by VS Code. 

**Core Principle**: Events are notifications only, no data payload. Clients fetch actual data via HTTP APIs.

```
┌──────────┐   Event: "fs.changed"    ┌──────────┐
│ Backend  │ ─────────────────────────► │ Frontend │
│ Service  │       WebSocket           │          │
└──────────┘                           └────┬─────┘
                                            │ 1. Receive notification
                                            │ 2. Call HTTP API
                                            ▼
┌──────────┐   GET /api/fs/list        ┌──────────┐
│ Backend  │ ◄───────────────────────── │ Frontend │
│ Service  │          HTTP             │          │
└──────────┘                           └──────────┘
```

## Event Types

Each event is a separate Go type:

| Event | Description |
|-------|-------------|
| `fs.changed` | Files/directories changed |
| `fs.created` | File/directory created |
| `fs.deleted` | File/directory deleted |
| `fs.renamed` | File/directory renamed |
| `asset.created` | Asset created |
| `asset.updated` | Asset updated |
| `asset.deleted` | Asset deleted |
| `tunnel.created` | Tunnel created |
| `tunnel.statusChanged` | Tunnel status changed |
| `tunnel.deleted` | Tunnel deleted |
| `container.statusChanged` | Container status changed |
| `container.listChanged` | Container list changed |
| `task.created` | Task created |
| `task.progress` | Task progress updated |
| `task.completed` | Task completed |

## Backend Usage

### Emitting Events

```go
import "github.com/choraleia/choraleia/pkg/event"

// In fs_service.go - after file operation
func (s *FSService) Upload(ctx context.Context, ...) error {
    // ... upload logic ...
    
    // Emit event
    event.Emit(event.FSCreatedEvent{
        AssetID: spec.AssetID,
        Path:    path,
        IsDir:   false,
    })
    return nil
}

// In asset_service.go - after asset CRUD
func (s *AssetService) Create(asset *Asset) error {
    // ... create logic ...
    
    event.Emit(event.AssetCreatedEvent{AssetID: asset.ID})
    return nil
}

// In tunnel_service.go - after status change
func (s *TunnelService) updateStatus(tunnel *Tunnel, status string) {
    tunnel.Status = status
    event.Emit(event.TunnelStatusChangedEvent{
        TunnelID: tunnel.ID,
        Status:   status,
    })
}
```

### Setting Up WebSocket Route

```go
// In router.go
wsHandler := event.NewWSHandler()
api.GET("/events/ws", wsHandler.Handle)
```

## Frontend Usage

### Initialize (App Root)

```tsx
import { useEventClientInit } from "@/api/event_hooks";

function App() {
  // Start event client
  useEventClientInit();
  
  return <YourApp />;
}
```

### Auto-Refresh Pattern (Recommended)

```tsx
import { useFSRefresh, useAssetRefresh, useTunnelRefresh } from "@/api/event_hooks";

// File list with auto-refresh
function FileManager({ assetId }: { assetId: string }) {
  const { data: files, loading, refresh } = useFSRefresh(
    assetId,
    () => api.listFiles(assetId),
    { delay: 100 }  // Debounce rapid events
  );
  
  return <FileList files={files} loading={loading} />;
}

// Asset tree with auto-refresh
function AssetTree() {
  const { data: assets, refresh } = useAssetRefresh(
    () => api.listAssets()
  );
  
  return <Tree items={assets} />;
}

// Tunnel list with auto-refresh
function TunnelList() {
  const { data: tunnels } = useTunnelRefresh(
    () => api.listTunnels()
  );
  
  return <List items={tunnels} />;
}
```

### Simple Trigger Pattern

If you manage data yourself:

```tsx
import { useOnFSChange, useOnAssetChange } from "@/api/event_hooks";

function FileManager({ assetId }: { assetId: string }) {
  const [files, setFiles] = useState([]);
  
  const refresh = useCallback(() => {
    api.listFiles(assetId).then(setFiles);
  }, [assetId]);
  
  // Auto-refresh when FS events fire
  useOnFSChange(assetId, refresh, 100);  // 100ms debounce
  
  useEffect(() => { refresh(); }, [refresh]);
  
  return <FileList files={files} />;
}
```

### Low-Level Event Subscription

```tsx
import { useEvent, Events } from "@/api/event_hooks";

function Component() {
  useEvent(Events.TASK_COMPLETED, (data) => {
    if (data.Success) {
      toast.success("Task completed!");
    }
  });
}
```

## Race Condition Handling

The system includes VS Code-style utilities:

### RefreshController

Handles the case where events arrive during an HTTP request:

```typescript
// Automatically handles:
// 1. Request starts (event count = 5)
// 2. Event arrives (event count = 6)  
// 3. Request completes
// 4. Controller sees event count changed, re-fetches
// 5. Shows latest data
```

### Delayer / ThrottledDelayer

Debounce rapid events:

```typescript
const delayer = new Delayer(100);

// Multiple rapid calls → only last one executes after 100ms
delayer.trigger(() => fetchData());
delayer.trigger(() => fetchData());
delayer.trigger(() => fetchData()); // Only this runs
```

## Files

```
pkg/event/
├── event.go    # Emitter (pub/sub)
├── events.go   # Event type definitions
└── ws.go       # WebSocket handler

frontend/src/api/
├── event_client.ts  # WebSocket client
├── event_hooks.ts   # React hooks
└── async.ts         # Delayer, Sequencer, RefreshController
```

## WebSocket Protocol

### Connection

```
GET /api/events/ws?events=fs.changed,asset.created,asset.deleted
```

### Message Format

```json
{
  "event": "fs.created",
  "data": {
    "AssetID": "asset-123",
    "Path": "/home/user/newfile.txt",
    "IsDir": false
  },
  "ts": 1704508800000
}
```

## Why This Design?

1. **No duplicate data endpoints** - Events don't carry full data, HTTP APIs do
2. **Type safety** - Each event is a separate Go type
3. **Race condition handled** - RefreshController ensures consistency
4. **Simple** - ~200 lines of Go, ~300 lines of TypeScript
5. **VS Code proven** - Same pattern used by VS Code for years

