/** A menu-scene request scope. Other catalog callers retain their own defaults. */
export interface CatalogRequestTiming {
  queueMs: number;
  headersMs: number;
  bodyMs: number;
  totalMs: number;
  status?: number;
  characters: number;
  aborted: boolean;
}

export class CatalogRequestBudget {
  readonly signal: AbortSignal;
  expired = false;
  private controller = new AbortController();
  private timer: ReturnType<typeof setTimeout>;
  private active = 0;
  private waiting: { start: () => void; reject: (reason: Error) => void }[] =
    [];
  private cancelFromCaller = () => this.close();

  constructor(
    milliseconds: number,
    private concurrency = 5,
    private callerSignal?: AbortSignal,
    private onTiming?: (timing: CatalogRequestTiming) => void,
  ) {
    this.signal = this.controller.signal;
    this.timer = setTimeout(() => {
      this.expired = true;
      this.close();
    }, milliseconds);
    if (callerSignal?.aborted) this.close();
    else
      callerSignal?.addEventListener('abort', this.cancelFromCaller, {
        once: true,
      });
  }

  assertActive() {
    if (this.signal.aborted) throw new Error('场景推荐请求已结束，请重试');
  }

  /** Ignore late adapter/native-fetch completion after cancellation. */
  wait<T>(work: Promise<T>): Promise<T> {
    if (this.signal.aborted)
      return Promise.reject(new Error('场景推荐请求已结束，请重试'));
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new Error('场景推荐请求已结束，请重试'));
      this.signal.addEventListener('abort', abort, { once: true });
      work.then(
        value => {
          this.signal.removeEventListener('abort', abort);
          if (!this.signal.aborted) resolve(value);
        },
        error => {
          this.signal.removeEventListener('abort', abort);
          reject(error);
        },
      );
    });
  }

  async run<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.assertActive();
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        this.active += 1;
        resolve();
      };
      if (this.active < this.concurrency) start();
      else this.waiting.push({ start, reject });
    });
    try {
      this.assertActive();
      return await this.wait(request(this.signal));
    } finally {
      this.active -= 1;
      if (!this.signal.aborted) this.waiting.shift()?.start();
    }
  }

  /** The permit and abort remain active until the entire response body arrives. */
  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const queuedAt=Date.now();
    let startedAt: number | undefined, headersAt: number | undefined, bodyAt: number | undefined;
    let status: number | undefined, characters=0;
    try { return await this.run(async signal => {
      startedAt=Date.now();
      const response = await fetch(url, { ...init, signal });
      headersAt=Date.now();
      status=response.status;
      this.assertActive();
      const text =
        typeof response.text === 'function'
          ? await response.text()
          : JSON.stringify(await response.json());
      bodyAt=Date.now();
      characters=text.length;
      this.assertActive();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return {
        ok: response.ok,
        status: response.status,
        text: async () => text,
        json: async () => JSON.parse(text),
      } as Response;
    }); } finally {
      const finishedAt=Date.now();
      this.onTiming?.({queueMs:(startedAt ?? finishedAt)-queuedAt,
        headersMs:startedAt===undefined?0:(headersAt ?? finishedAt)-startedAt,
        bodyMs:headersAt===undefined?0:(bodyAt ?? finishedAt)-headersAt,
        totalMs:finishedAt-queuedAt,status,characters,aborted:this.signal.aborted});
    }
  }

  close() {
    clearTimeout(this.timer);
    this.callerSignal?.removeEventListener('abort', this.cancelFromCaller);
    if (this.signal.aborted) return;
    this.controller.abort();
    const error = new Error('场景推荐请求已结束，请重试');
    this.waiting.splice(0).forEach(item => item.reject(error));
  }
}
