import { describe, it, expect } from 'vitest';
import { litBodyKeys, drainInIdle, type IdleDeadlineLike } from '../../src/ui/litWarmup';

describe('litWarmup — pre-build headlight silhouettes in idle time', () => {
  it('picks the sprites a headlight can light (vehicles, trains, people), cars first, nothing else', () => {
    const keys = ['@sprite/bird/0', '@sprite/ped/0/1/0', '@sprite/car/3/2', '@wear/2', '@sprite/train/loco/1', '@sprite/cop/4/1', '@sprite/bike/1/2/1', '@sprite/car-light/2', '@sprite/smog/1/0', '@sprite/car/0/0'];
    expect(litBodyKeys(keys)).toEqual(['@sprite/car/3/2', '@sprite/car/0/0', '@sprite/cop/4/1', '@sprite/train/loco/1', '@sprite/ped/0/1/0', '@sprite/bike/1/2/1']);
  });

  it('runs jobs only while the idle deadline has time, rescheduling until the queue drains', () => {
    const ran: number[] = [];
    const jobs = [0, 1, 2, 3, 4, 5, 6].map((i) => () => void ran.push(i));
    const pending: ((d: IdleDeadlineLike) => void)[] = [];
    drainInIdle(jobs, (cb) => void pending.push(cb));
    expect(ran).toEqual([]); // nothing runs until the browser is idle
    let budget = 3; // each idle period has room for three jobs
    const deadline: IdleDeadlineLike = { timeRemaining: () => budget-- > 0 ? 5 : 0 };
    pending.shift()!(deadline);
    expect(ran).toEqual([0, 1, 2]);
    expect(pending.length).toBe(1);
    budget = 3;
    pending.shift()!(deadline);
    budget = 3;
    pending.shift()!(deadline);
    expect(ran).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(pending.length).toBe(0); // drained → no further callback
  });

  it('always makes progress (one job per idle period even with no time left) and stops on a throwing job', () => {
    const ran: number[] = [];
    const pending: ((d: IdleDeadlineLike) => void)[] = [];
    const jobs = [() => void ran.push(0), () => { throw new Error('no canvas'); }, () => void ran.push(2)];
    drainInIdle(jobs, (cb) => void pending.push(cb));
    const none: IdleDeadlineLike = { timeRemaining: () => 0 };
    pending.shift()!(none);
    expect(ran).toEqual([0]);
    pending.shift()!(none); // throws → warming stops; the lazy path still covers the rest
    expect(pending.length).toBe(0);
    expect(ran).toEqual([0]);
  });
});
