/** Keeps the phone screen on while you're watching the sky (Screen Wake Lock API). */
export class KeepAwake {
  private sentinel: WakeLockSentinel | undefined;
  private wanted = false;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      // The lock is released whenever the page is hidden; take it again on return.
      if (this.wanted && document.visibilityState === 'visible') void this.acquire();
    });
  }

  static supported(): boolean {
    return 'wakeLock' in navigator;
  }

  async set(on: boolean): Promise<void> {
    this.wanted = on;
    if (on) await this.acquire();
    else {
      await this.sentinel?.release().catch(() => undefined);
      this.sentinel = undefined;
    }
  }

  private async acquire(): Promise<void> {
    if (!KeepAwake.supported() || (this.sentinel && !this.sentinel.released)) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
    } catch {
      /* denied (e.g. battery saver) */
    }
  }
}
