/** Bound an issued car selection to the phone's existing cancellable preparation. */
export class CarPlayRequest {
  private abort = new AbortController();
  constructor(private stopPreparation: () => Promise<void>, private isActive: () => Promise<boolean>) {}
  cancel() { this.abort.abort(); }
  assertActive() { if (this.abort.signal.aborted) throw new Error('车机点歌请求已失效'); }
  async run<T>(work: () => Promise<T>): Promise<T> {
    this.assertActive();
    let timedOut = false, checking = false, settled = false;
    let rejectCancelled!: (error: Error) => void;
    const cancel = () => {
      this.stopPreparation().catch(() => undefined);
      rejectCancelled(new Error(timedOut ? '车机点歌超时，请重试或选择其它歌曲' : '车机点歌请求已失效'));
    };
    const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
    this.abort.signal.addEventListener('abort', cancel, { once: true });
    const deadline = setTimeout(() => { timedOut = true; this.cancel(); }, 14_000);
    const monitor = setInterval(() => {
      if (checking || settled) return;
      checking = true;
      this.isActive().then(active => { if (!settled && !active) this.cancel(); }, () => {
        if (!settled) this.cancel();
      }).finally(() => { checking = false; });
    }, 500);
    try { return await Promise.race([work(), cancelled]); }
    finally {
      settled = true;
      clearTimeout(deadline); clearInterval(monitor);
      this.abort.signal.removeEventListener('abort', cancel);
    }
  }
}
