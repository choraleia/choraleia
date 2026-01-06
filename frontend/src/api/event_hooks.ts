// Event Hooks - Pure React hooks for event subscriptions
//
// Generic hooks with no business logic.
// Business-specific hooks should be defined in separate files.

import { useEffect, useRef } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { eventClient, RECONNECT_EVENT, type EventName, type EventData } from "./event_client";
import { ThrottledDelayer } from "./async";

// Re-export types and eventClient
export type { EventName, EventData } from "./event_client";
export { RECONNECT_EVENT, eventClient } from "./event_client";

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize event client. Call once at app root.
 */
export function useEventClientInit(events?: EventName[]) {
  useEffect(() => {
    eventClient.start(events);
    return () => eventClient.stop();
  }, []);
}

/**
 * Invalidate queries when WebSocket reconnects.
 * Use this to refresh data that might have changed during disconnection.
 */
export function useInvalidateOnReconnect(queryKey: QueryKey) {
  const queryClient = useQueryClient();

  useEffect(() => {
    return eventClient.on(RECONNECT_EVENT, () => {
      console.log("[useInvalidateOnReconnect] Refreshing:", queryKey);
      queryClient.invalidateQueries({ queryKey });
    });
  }, [queryClient, queryKey]);
}

// ============================================================================
// Basic Event Subscriptions
// ============================================================================

/**
 * Subscribe to a single event.
 */
export function useEvent<T extends EventData = EventData>(
  event: EventName,
  handler: (data: T, event: EventName) => void
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return eventClient.on<T>(event, (data) => handlerRef.current(data, event));
  }, [event]);
}

/**
 * Subscribe to multiple events.
 */
export function useEvents(
  events: EventName[],
  handler: (data: EventData, event: EventName) => void
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unsubscribes = events.map((event) =>
      eventClient.on(event, (data) => handlerRef.current(data, event))
    );
    return () => unsubscribes.forEach((unsub) => unsub());
  }, [events.join(",")]);
}

// ============================================================================
// TanStack Query Invalidation
// ============================================================================

export interface InvalidateOptions<T extends EventData = EventData> {
  /** Filter function to decide if event should trigger invalidation */
  filter?: (data: T, event: EventName) => boolean;
  /** Throttle invalidation (ms). First event triggers immediately. */
  throttle?: number;
}

/**
 * Invalidate TanStack Query cache when events fire.
 */
export function useInvalidateOnEvent<T extends EventData = EventData>(
  events: EventName[],
  queryKey: QueryKey,
  options?: InvalidateOptions<T>
) {
  const queryClient = useQueryClient();
  const throttlerRef = useRef<ThrottledDelayer<void> | null>(null);

  useEffect(() => {
    if (options?.throttle) {
      throttlerRef.current = new ThrottledDelayer(options.throttle, 0);
    }
    return () => throttlerRef.current?.cancel();
  }, [options?.throttle]);

  useEffect(() => {
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey });
    };

    const unsubscribes = events.map((event) =>
      eventClient.on<T>(event, (data) => {
        if (options?.filter && !options.filter(data, event)) {
          return;
        }
        if (throttlerRef.current) {
          throttlerRef.current.trigger(invalidate);
        } else {
          invalidate();
        }
      })
    );

    return () => unsubscribes.forEach((unsub) => unsub());
  }, [events.join(","), queryClient, queryKey]);
}

// ============================================================================
// Simple Callback Hooks
// ============================================================================

/**
 * Call a function when events fire (without data).
 */
export function useOnEvent<T extends EventData = EventData>(
  events: EventName[],
  onEvent: () => void,
  options?: InvalidateOptions<T>
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const throttlerRef = useRef<ThrottledDelayer<void> | null>(null);

  useEffect(() => {
    if (options?.throttle) {
      throttlerRef.current = new ThrottledDelayer(options.throttle, 0);
    }
    return () => throttlerRef.current?.cancel();
  }, [options?.throttle]);

  useEffect(() => {
    const unsubscribes = events.map((event) =>
      eventClient.on<T>(event, (data) => {
        if (options?.filter && !options.filter(data, event)) {
          return;
        }
        if (throttlerRef.current) {
          throttlerRef.current.trigger(() => onEventRef.current());
        } else {
          onEventRef.current();
        }
      })
    );

    return () => unsubscribes.forEach((unsub) => unsub());
  }, [events.join(",")]);
}

export interface EventWithDataOptions<T extends EventData = EventData> {
  /** Filter function to decide if event should trigger callback */
  filter?: (data: T, event: EventName) => boolean;
}

/**
 * Call a function with event data when events fire.
 * Use this for fine-grained cache updates based on event payload.
 */
export function useOnEventWithData<T extends EventData = EventData>(
  events: EventName[],
  onEvent: (data: T, event: EventName) => void,
  options?: EventWithDataOptions<T>
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const unsubscribes = events.map((event) =>
      eventClient.on<T>(event, (data) => {
        if (options?.filter && !options.filter(data, event)) {
          return;
        }
        onEventRef.current(data, event);
      })
    );

    return () => unsubscribes.forEach((unsub) => unsub());
  }, [events.join(",")]);
}

