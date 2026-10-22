import type { Track } from '../domain/types';

export interface MediaRequestOptions {
  signal?: AbortSignal;
  priority?: 'foreground' | 'background';
  onTracks?: (tracks: Track[]) => void;
}

const cancelled = () => Object.assign(new Error('媒体请求已取消'), { name: 'AbortError' });
export class MediaRateLimitError extends Error {}
const temporary = (error: unknown) =>
  !(error instanceof MediaRateLimitError) &&
  /\b406\b|HTTP (408|429|5\d\d)|timeout|timed out|Network request failed|fetch failed/i.test(
    error instanceof Error ? error.message : String(error),
  );

interface PendingRequest {
  key: string;
  priority: 'foreground' | 'background';
  controller: AbortController;
  deadline: number;
  started: boolean;
  settled: boolean;
  subscribers: number;
  timer: ReturnType<typeof setTimeout>;
  run: (signal: AbortSignal, remainingMs: number) => Promise<unknown>;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  attempts: number;
}

export function createMediaRequestPool(concurrency: number, budgetMs = 6000) {
  const requests = new Map<string, PendingRequest>();
  const queue: PendingRequest[] = [];
  let active = 0;

  const finish = (job: PendingRequest, value: unknown, error?: unknown) => {
    if (job.settled) return;
    job.settled = true;
    clearTimeout(job.timer);
    requests.delete(job.key);
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
    if (job.started) active -= 1;
    if (error) {
      job.controller.abort();
      job.reject(error);
    } else job.resolve(value);
    console.info('[media-request]', JSON.stringify({
      key: job.key, elapsedMs: budgetMs - Math.max(0, job.deadline - Date.now()),
      attempts: job.attempts, outcome: error ? 'failed' : 'ok',
    }));
    pump();
  };
  const retryPause = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 250);
    signal.addEventListener('abort', abort, { once: true });
  });
  const execute = async (job: PendingRequest) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (job.settled || job.controller.signal.aborted) return;
      if (job.deadline <= Date.now()) {
        finish(job, undefined, new Error('媒体请求超时，请重试'));
        return;
      }
      job.attempts += 1;
      try {
        const value = await job.run(job.controller.signal, Math.max(1, job.deadline - Date.now()));
        finish(job, value);
        return;
      } catch (error) {
        if (job.settled) return;
        if (attempt || !temporary(error) || job.deadline - Date.now() <= 250) {
          finish(job, undefined, error);
          return;
        }
        try { await retryPause(job.controller.signal); }
        catch (reason) { finish(job, undefined, reason); return; }
      }
    }
  };
  function pump() {
    while (active < concurrency && queue.length) {
      const foreground = queue.findIndex(job => job.priority === 'foreground');
      const [job] = queue.splice(foreground >= 0 ? foreground : 0, 1);
      if (job.settled) continue;
      job.started = true;
      active += 1;
      void execute(job);
    }
  }

  return function run<T>(
    key: string,
    requestPage: (signal: AbortSignal, remainingMs: number) => Promise<T>,
    options: MediaRequestOptions = {},
  ): Promise<T> {
    if (options.signal?.aborted) return Promise.reject(cancelled());
    let job = requests.get(key);
    if (!job) {
      let resolve!: (value: unknown) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
      job = {
        key, priority: options.priority ?? 'background', controller: new AbortController(),
        deadline: Date.now() + budgetMs, started: false, settled: false, subscribers: 0,
        timer: undefined as unknown as ReturnType<typeof setTimeout>,
        run: requestPage, promise, resolve, reject, attempts: 0,
      };
      const created = job;
      job.timer = setTimeout(() => finish(created, undefined, new Error('媒体请求超时，请重试')), budgetMs);
      requests.set(key, job);
      queue.push(job);
    } else if (options.priority === 'foreground') job.priority = 'foreground';
    const subscribed = job;
    subscribed.subscribers += 1;
    const result = new Promise<T>((resolve, reject) => {
      let done = false;
      const cleanup = () => {
        if (done) return false;
        done = true;
        options.signal?.removeEventListener('abort', abort);
        subscribed.subscribers -= 1;
        return true;
      };
      const abort = () => {
        if (!cleanup()) return;
        reject(cancelled());
        if (!subscribed.subscribers && !subscribed.settled) finish(subscribed, undefined, cancelled());
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      subscribed.promise.then(
        value => { if (cleanup()) resolve(value as T); },
        error => { if (cleanup()) reject(error); },
      );
    });
    pump();
    return result;
  };
}

export const runMediaCatalogRequest = createMediaRequestPool(3);
export const runMediaEpisodeRequest = createMediaRequestPool(3);
