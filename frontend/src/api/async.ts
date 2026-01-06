// Async utilities for handling race conditions.
//
// - Delayer: Debounce multiple triggers into one execution
// - Sequencer: Serialize async operations
// - ThrottledDelayer: Rate-limited execution

// ============================================================================
// Delayer - Debounce multiple triggers into one execution
// ============================================================================

export class Delayer<T> {
  private timeout: number | null = null;
  private completionPromise: Promise<T> | null = null;
  private onComplete: ((value: T) => void) | null = null;
  private task: (() => T | Promise<T>) | null = null;

  constructor(private defaultDelay: number) {}

  /**
   * Trigger the delayer. If called multiple times within the delay,
   * only the last task will be executed.
   */
  trigger(task: () => T | Promise<T>, delay = this.defaultDelay): Promise<T> {
    this.task = task;
    this.cancelTimeout();

    if (!this.completionPromise) {
      this.completionPromise = new Promise<T>((resolve) => {
        this.onComplete = resolve;
      });
    }

    this.timeout = window.setTimeout(() => {
      this.timeout = null;
      const currentTask = this.task!;
      this.task = null;

      const result = currentTask();
      if (result instanceof Promise) {
        result.then(
          (value) => this.doResolve(value),
          () => this.doResolve(undefined as T)
        );
      } else {
        this.doResolve(result);
      }
    }, delay);

    return this.completionPromise;
  }

  private doResolve(value: T) {
    if (this.onComplete) {
      this.onComplete(value);
      this.completionPromise = null;
      this.onComplete = null;
    }
  }

  private cancelTimeout() {
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  /** Cancel pending execution */
  cancel() {
    this.cancelTimeout();
    this.completionPromise = null;
    this.onComplete = null;
    this.task = null;
  }

  /** Check if there's a pending execution */
  isTriggered(): boolean {
    return this.timeout !== null;
  }
}

// ============================================================================
// Sequencer - Serialize async operations (no concurrent execution)
// ============================================================================

export class Sequencer {
  private current: Promise<unknown> = Promise.resolve();

  /**
   * Queue a task. Tasks are executed sequentially, one after another.
   */
  queue<T>(task: () => Promise<T>): Promise<T> {
    return (this.current = this.current.then(
      () => task(),
      () => task()
    )) as Promise<T>;
  }
}

// ============================================================================
// ThrottledDelayer - Rate-limited execution with immediate first call
// ============================================================================

export class ThrottledDelayer<T> {
  private delayer: Delayer<T>;
  private lastExecuted = 0;

  constructor(
    private minInterval: number,
    defaultDelay = 0
  ) {
    this.delayer = new Delayer<T>(defaultDelay);
  }

  /**
   * Trigger execution. First call runs immediately,
   * subsequent calls within minInterval are delayed.
   */
  trigger(task: () => T | Promise<T>): Promise<T> {
    const now = Date.now();
    const elapsed = now - this.lastExecuted;

    const wrappedTask = async (): Promise<T> => {
      const result = await Promise.resolve(task());
      this.lastExecuted = Date.now();
      return result;
    };

    if (elapsed >= this.minInterval) {
      return this.delayer.trigger(wrappedTask);
    } else {
      const waitTime = this.minInterval - elapsed;
      return this.delayer.trigger(wrappedTask, waitTime);
    }
  }

  cancel() {
    this.delayer.cancel();
  }
}

