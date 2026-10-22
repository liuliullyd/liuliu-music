type Update = { apply: () => Promise<boolean>; finish: (success: boolean) => void; urgent: boolean };

/** One native update at a time; drag events retain only the latest pending curve. */
export class EqualizerUpdates {
  private pending: Update | null = null;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastStarted = -Infinity;
  private flushing = false;
  private closed = false;

  get busy() { return this.running || this.pending !== null; }

  request(apply: () => Promise<boolean>, urgent = true): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    return new Promise(finish => {
      this.pending?.finish(false);
      this.pending = { apply, finish, urgent };
      if (urgent) this.flush();
      else this.pump();
    });
  }

  flush() {
    this.flushing = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pump();
  }

  dispose() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending?.finish(false);
    this.pending = null;
  }

  private pump() {
    if (this.closed || this.running || !this.pending || this.timer) return;
    const delay = 40 - (Date.now() - this.lastStarted);
    if (!this.flushing && !this.pending.urgent && delay > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, delay);
      return;
    }
    const update = this.pending;
    this.pending = null;
    this.flushing = false;
    this.running = true;
    this.lastStarted = update.urgent ? -Infinity : Date.now();
    const run = async () => {
      try { update.finish(await update.apply()); }
      catch { update.finish(false); }
      finally { this.running = false; this.pump(); }
    };
    run();
  }
}
