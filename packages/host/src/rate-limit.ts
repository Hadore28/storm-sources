/** Lets at most `requests` through in any `perMs` window; callers wait their turn in order. */
export class RateLimiter {
  private stamps: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private requests: number,
    private perMs: number,
  ) {}

  acquire(): Promise<void> {
    const turn = this.queue.then(() => this.wait());
    this.queue = turn.catch(() => {});
    return turn;
  }

  private async wait() {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < this.perMs);
      if (this.stamps.length < this.requests) {
        this.stamps.push(now);
        return;
      }
      await Bun.sleep(this.stamps[0] + this.perMs - now + 5);
    }
  }
}
