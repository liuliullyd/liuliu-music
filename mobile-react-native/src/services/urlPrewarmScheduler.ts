export type UrlPrewarmLane = 'home-visible' | 'queue';
export type UrlPrewarmOutcome = 'success' | 'failed' | 'cancelled';

type UrlPrewarmTask = {
  key: string;
  lane: UrlPrewarmLane;
  run: (signal: AbortSignal) => Promise<unknown>;
  onFailure?: (signal: AbortSignal) => void | Promise<void>;
  attempts: number;
  active: boolean;
  finalFailure?: boolean;
  validateAfterAddress?: boolean;
  owners: Set<object | undefined>;
  controller?: AbortController;
  completion?: Promise<void>;
  outcome: Promise<UrlPrewarmOutcome>;
  resolveOutcome: (outcome: UrlPrewarmOutcome) => void;
};

export class UrlPrewarmScheduler {
  private readonly homeQueue: UrlPrewarmTask[] = [];
  private readonly queueQueue: UrlPrewarmTask[] = [];
  private readonly retryQueue: UrlPrewarmTask[] = [];
  private readonly pending = new Map<string, UrlPrewarmTask>();
  private readonly activeTasks = new Set<UrlPrewarmTask>();
  private readonly holds = new Set<symbol>();
  private readonly idleWaiters: Array<() => void> = [];
  private readonly queueIdleWaiters: Array<() => void> = [];
  private active = 0;
  private playbackReady = true;
  private queueOrder = new Map<string, number>();

  constructor(
    private readonly maxConcurrent = 2,
    private readonly maxAttempts = 2,
  ) {}

  enqueue(
    lane: UrlPrewarmLane,
    key: string,
    run: (signal: AbortSignal) => Promise<unknown>,
    owner?: object,
    onFailure?: (signal: AbortSignal) => void | Promise<void>,
  ) {
    const existing = this.pending.get(key);
    if (existing) {
      existing.owners.add(owner);
      existing.run = run;
      if (lane === 'queue' && onFailure) existing.onFailure = onFailure;
      if (lane === 'queue' && existing.lane !== lane) {
        existing.lane = lane;
        // An already running page task only obtains an address. Its success
        // cannot certify the queue's subsequently requested audio validation.
        if (existing.active) existing.validateAfterAddress = true;
        const index = this.homeQueue.indexOf(existing);
        if (index >= 0) {
          this.homeQueue.splice(index, 1);
          this.queueQueue.push(existing);
        }
        this.sortQueue();
      }
      this.drain();
      return existing.outcome;
    }
    let resolveOutcome!: (outcome: UrlPrewarmOutcome) => void;
    const outcome = new Promise<UrlPrewarmOutcome>(resolve => {
      resolveOutcome = resolve;
    });
    const task: UrlPrewarmTask = {
      key,
      lane,
      run,
      ...(lane === 'queue' && onFailure ? { onFailure } : {}),
      attempts: 0,
      active: false,
      owners: new Set([owner]),
      outcome,
      resolveOutcome,
    };
    this.pending.set(key, task);
    (lane === 'queue' ? this.queueQueue : this.homeQueue).push(task);
    this.sortQueue();
    this.drain();
    return task.outcome;
  }

  hold() {
    const token = Symbol('url-prewarm-hold');
    this.holds.add(token);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds.delete(token);
      this.drain();
    };
  }

  /** Hold admission before calling this; native abort acknowledgement releases the slot. */
  async preemptExcept(key?: string) {
    const interrupted = [...this.activeTasks].filter(
      task => task.active && (task.key !== key || task.finalFailure),
    );
    interrupted.forEach(task => task.controller?.abort());
    await Promise.all(interrupted.map(task => task.completion));
  }

  /** Failed selections retain this gate until a matching native PLAYING event. */
  setPlaybackReady(ready: boolean) {
    this.playbackReady = ready;
    this.drain();
  }

  setQueueOrder(keys: string[]) {
    this.queueOrder = new Map(keys.map((key, index) => [key, index]));
    for (const task of [...this.pending.values()]) {
      if (task.lane === 'queue' && !this.queueOrder.has(task.key)) {
        this.cancel(task);
      }
    }
    this.removeStaleQueued();
    this.sortQueue();
    this.drain();
  }

  reset() {
    [...this.pending.values()].forEach(task => this.cancel(task));
    this.homeQueue.length = 0;
    this.queueQueue.length = 0;
    this.retryQueue.length = 0;
    this.queueOrder.clear();
    this.notifyIdle();
    this.notifyQueueIdle();
  }

  /** A detail viewport relinquishes only its tasks; coalesced queue/Home work survives. */
  retainOwner(owner: object, keys: string[]) {
    const retained = new Set(keys);
    for (const task of this.pending.values()) {
      if (retained.has(task.key) || !task.owners.delete(owner)) continue;
      if (task.owners.size) continue;
      this.cancel(task);
    }
    this.removeStaleQueued();
    this.drain();
  }

  snapshot() {
    return {
      active: this.active,
      homeQueued: this.homeQueue.length,
      queueQueued: this.queueQueue.length,
      retryQueued: this.retryQueue.length,
      pending: this.pending.size,
      paused: this.holds.size > 0,
    };
  }

  whenIdle() {
    if (this.isIdle()) return Promise.resolve();
    return new Promise<void>(resolve => this.idleWaiters.push(resolve));
  }

  /** Resolves only after every queue-lane URL task, including retries, settles. */
  whenQueueIdle() {
    if (this.isQueueIdle()) return Promise.resolve();
    return new Promise<void>(resolve => this.queueIdleWaiters.push(resolve));
  }

  private drain() {
    if (this.holds.size || !this.playbackReady) return;
    while (this.active < this.maxConcurrent) {
      const task = this.takeNext();
      if (!task) return;
      task.active = true;
      if (task.lane === 'queue') task.validateAfterAddress = false;
      this.activeTasks.add(task);
      task.controller = new AbortController();
      const signal = task.controller.signal;
      this.active += 1;
      task.completion = Promise.resolve()
        .then(() => {
          if (signal.aborted) throw new Error('URL prewarm interrupted');
          return task.run(signal);
        })
        .then(
          () => this.finish(task, true),
          () => this.finish(task, false),
        );
    }
  }

  private takeNext() {
    const queueActive = [...this.activeTasks].some(task => task.lane === 'queue');
    for (const queue of [this.retryQueue, this.queueQueue, this.homeQueue]) {
      for (let index = 0; index < queue.length;) {
        const task = queue[index]!;
        if (this.pending.get(task.key) !== task) { queue.splice(index, 1); continue; }
        if (queueActive && task.lane === 'queue') { index += 1; continue; }
        queue.splice(index, 1);
        return task;
      }
    }
    return undefined;
  }

  private sortQueue() {
    this.queueQueue.sort(
      (left, right) =>
        (this.queueOrder.get(left.key) ?? Infinity) -
        (this.queueOrder.get(right.key) ?? Infinity),
    );
  }

  private removeStaleQueued() {
    for (const queue of [this.queueQueue, this.homeQueue, this.retryQueue]) {
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        const task = queue[index]!;
        if (this.pending.get(task.key) !== task) queue.splice(index, 1);
      }
    }
    this.notifyIdle();
    this.notifyQueueIdle();
  }

  private notifyIdle() {
    if (this.isIdle()) this.idleWaiters.splice(0).forEach(resolve => resolve());
  }

  private notifyQueueIdle() {
    if (this.isQueueIdle())
      this.queueIdleWaiters.splice(0).forEach(resolve => resolve());
  }

  private async finish(task: UrlPrewarmTask, succeeded: boolean) {
    if (this.pending.get(task.key) !== task) {
      task.resolveOutcome('cancelled');
    } else if (task.controller?.signal.aborted) {
      (task.lane === 'queue' ? this.queueQueue : this.homeQueue).unshift(task);
      this.sortQueue();
    } else if (task.validateAfterAddress) {
      task.validateAfterAddress = false;
      this.queueQueue.push(task);
      this.sortQueue();
    } else if (succeeded) {
      this.pending.delete(task.key);
      task.resolveOutcome('success');
    }
    else {
      task.attempts += 1;
      if (task.attempts < this.maxAttempts) this.retryQueue.push(task);
      else {
        // A terminal outcome belongs to this song, independently of native
        // cleanup or the rest of the queue, including coalesced detail owners.
        task.resolveOutcome('failed');
        if (task.lane === 'queue' && task.onFailure) {
          task.finalFailure = true;
          try {
            await task.onFailure(task.controller!.signal);
          } catch (error) {
            console.error('[url-prewarm] queue failure removal failed', error);
          }
        }
        if (this.pending.get(task.key) === task)
          this.pending.delete(task.key);
      }
    }
    task.active = false;
    this.activeTasks.delete(task);
    this.active -= 1;
    this.drain();
    this.notifyIdle();
    this.notifyQueueIdle();
  }

  private cancel(task: UrlPrewarmTask) {
    if (this.pending.get(task.key) === task) this.pending.delete(task.key);
    task.resolveOutcome('cancelled');
    task.controller?.abort();
  }

  private isIdle() {
    return (
      this.active === 0 &&
      this.homeQueue.length === 0 &&
      this.queueQueue.length === 0 &&
      this.retryQueue.length === 0
    );
  }

  private isQueueIdle() {
    return (
      ![...this.pending.values()].some(task => task.lane === 'queue') &&
      ![...this.activeTasks].some(task => task.lane === 'queue') &&
      this.queueQueue.length === 0
    );
  }
}
