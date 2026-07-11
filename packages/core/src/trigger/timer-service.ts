import { type Logger, createSilentLogger } from "../logger.js";

export class TimerService {
  private static POLL_INTERVAL = 10 * 60 * 1000;
  private timer: NodeJS.Timeout | null = null;
  private logger: Logger;

  constructor(
    private onTick: () => void,
    logger?: Logger,
  ) {
    this.logger = logger ?? createSilentLogger();
  }

  start(): void {
    const now = Date.now();
    const msToNext = TimerService.POLL_INTERVAL - (now % TimerService.POLL_INTERVAL);
    this.scheduleNext(msToNext);
  }

  private scheduleNext(delay: number): void {
    this.timer = setTimeout(() => {
      this.onTick();
      this.scheduleNext(TimerService.POLL_INTERVAL);
    }, delay);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.logger.info("timer service stopped");
  }
}
