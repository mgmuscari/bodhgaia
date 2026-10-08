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

describe('the clock only ever moves forward', () => {
  afterEach(() => resetGameTime());
  it('setGameHour goes to the NEXT start of that hour — never back in the day (the economy counts hours)', () => {
    setGameHour(23, 0);
    const late = gameClock(gameSec(0));
    expect(late.hour).toBe(23);
    setGameHour(6, 10_000); // dawn after a night (10 s ≈ 1½ game hours later): forward, not back to the first morning
    const dawn = gameClock(gameSec(10_000));
    expect(dawn.hour).toBe(6);
    expect(dawn.slot).toBeGreaterThan(late.slot);
    expect(dawn.slot - late.slot).toBe(7);
  });
});
