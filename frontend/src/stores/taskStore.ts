// Task Store - TanStack Query based state management for tasks
//
// Event handling strategy:
// - Global event subscription (not per-hook) to avoid duplicate listeners
// - Task created/completed → refresh the list
// - Task progress → update single task in cache directly (no refetch)

import { useQuery, useMutation, useQueryClient, QueryClient } from "@tanstack/react-query";
import { tasksList, tasksCancel, type Task } from "../api/tasks";
import { eventClient, RECONNECT_EVENT } from "../api/event_hooks";
import { Events, type TaskEventData } from "../api/events";

// ============================================================================
// Query Keys
// ============================================================================

export const taskKeys = {
  all: ["tasks"] as const,
  list: (limit?: number) => [...taskKeys.all, "list", limit] as const,
};

// ============================================================================
// Global Event Subscription (singleton)
// ============================================================================

let taskEventsInitialized = false;

/**
 * Initialize global task event subscriptions.
 * Call this once at app startup.
 */
export function initTaskEvents(queryClient: QueryClient) {
  if (taskEventsInitialized) return;
  taskEventsInitialized = true;

  // On task created/completed, refresh the list
  eventClient.on(Events.TASK_CREATED, () => {
    queryClient.invalidateQueries({ queryKey: taskKeys.all });
  });

  eventClient.on(Events.TASK_COMPLETED, () => {
    queryClient.invalidateQueries({ queryKey: taskKeys.all });
  });

  // On progress, update the specific task in cache directly (no API call)
  eventClient.on<TaskEventData>(Events.TASK_PROGRESS, (data) => {
    if (!data.TaskID) return;

    const taskId = data.TaskID;
    const total = typeof data.Total === "number" ? data.Total : undefined;
    const done = typeof data.Done === "number" ? data.Done : undefined;
    const unit = typeof data.Unit === "string" ? data.Unit : undefined;
    const note = typeof data.Note === "string" ? data.Note : undefined;

    // Update all task list queries
    queryClient.setQueriesData<Task[]>(
      { queryKey: taskKeys.all },
      (old) => {
        if (!old) return old;
        return old.map((t): Task =>
          t.id === taskId
            ? {
                ...t,
                progress: {
                  total: total !== undefined ? total : t.progress.total,
                  done: done !== undefined ? done : t.progress.done,
                  unit: unit !== undefined ? unit : t.progress.unit,
                  note: note !== undefined ? note : t.progress.note,
                },
              }
            : t
        );
      }
    );
  });

  // On reconnect, refresh all task queries
  eventClient.on(RECONNECT_EVENT, () => {
    queryClient.invalidateQueries({ queryKey: taskKeys.all });
  });
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to fetch all tasks (active + history).
 * Event subscriptions are handled globally, not per-hook.
 */
export function useTaskList(limit = 50) {
  return useQuery({
    queryKey: taskKeys.list(limit),
    queryFn: () => tasksList(limit),
  });
}

/**
 * Hook to get tasks with computed active/history views.
 * This is the main hook for TaskCenter component.
 */
export function useTasks(historyLimit = 50) {
  const { data: allTasks = [], isLoading, error } = useTaskList(historyLimit);

  // Compute active and history from the unified list
  const active = allTasks.filter(
    (t) => t.status === "running" || t.status === "queued"
  );
  const history = allTasks.filter(
    (t) => t.status !== "running" && t.status !== "queued"
  );

  return {
    active,
    history,
    allTasks,
    loading: isLoading,
    error,
  };
}

/**
 * Hook to cancel a task.
 * Note: Task completion event will refresh the list automatically.
 */
export function useCancelTask() {
  return useMutation({
    mutationFn: tasksCancel,
    // No need to invalidate - TaskCompleted event will handle it
  });
}

/**
 * Hook to manually invalidate task queries.
 */
export function useInvalidateTasks() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: taskKeys.all });
}

