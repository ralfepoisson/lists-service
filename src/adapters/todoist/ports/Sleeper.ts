export interface Sleeper {
  sleep(delayMilliseconds: number): Promise<void>;
}

export class TimerSleeper implements Sleeper {
  async sleep(delayMilliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMilliseconds);
    });
  }
}
