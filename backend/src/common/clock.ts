import { PacificDate, pacificDateFromUtc } from './pacific-date';

export abstract class Clock {
  abstract now(): Date;
  today(): PacificDate {
    return pacificDateFromUtc(this.now());
  }
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock extends Clock {
  private current: Date;

  constructor(initial: Date) {
    super();
    this.current = new Date(initial.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(d: Date): void {
    this.current = new Date(d.getTime());
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Nest provider: inject `Clock` (abstract class token), backed by the real clock. */
export const clockProvider = { provide: Clock, useClass: SystemClock };
