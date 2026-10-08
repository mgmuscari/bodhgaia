import { describe, it, expect, afterEach } from 'vitest';
import { gameSec, setGameHour, resetGameTime } from '../../src/ui/gameTime';
import { gameClock } from '../../src/ui/lighting';

describe('game time', () => {
  afterEach(() => resetGameTime());

  it('is wall time until the opening sets the hour', () => {
    expect(gameSec(5000)).toBe(5);
    expect(gameClock(gameSec(0)).hour).toBe(6); // a city wakes at 06:00 as before
  });

  it('setGameHour makes "now" the start of that hour, and time runs on from there', () => {
    setGameHour(0, 10_000);
    expect(gameClock(gameSec(10_000)).hour).toBe(0);
    expect(gameClock(gameSec(10_000 + 7_000)).hour).toBe(1); // ~6.5 s an hour
    setGameHour(22, 50_000);
    expect(gameClock(gameSec(50_000)).hour).toBe(22);
  });
});
