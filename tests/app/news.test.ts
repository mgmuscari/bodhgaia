import { describe, it, expect } from 'vitest';
import { feedWith, newArrests, jamOf, FEED_MAX } from '../../src/app/news';

describe('the news feed', () => {
  it('keeps the newest headlines, oldest dropped first', () => {
    let feed: string[] = [];
    for (let i = 0; i < FEED_MAX + 3; i++) feed = feedWith(feed, [`h${i}`]);
    expect(feed.length).toBe(FEED_MAX);
    expect(feed.at(-1)).toBe(`h${FEED_MAX + 2}`);
    expect(feed[0]).toBe('h3');
  });
});

describe('sampling the city', () => {
  const W = 10;
  it('an arrest is a police-violence stain that grew since the last sample (fading is not one)', () => {
    const prev = new Map([[2 * W + 3, 10], [5 * W + 5, 10]]);
    const now = new Map([[2 * W + 3, 14], [5 * W + 5, 8], [7 * W + 1, 3]]);
    expect(newArrests(prev, now, W)).toEqual([{ x: 3, y: 2 }, { x: 1, y: 7 }]);
  });
  it('counts jammed road tiles and finds the worst', () => {
    const traffic = new Map([[3, 250], [7, 210], [9, 40]]);
    expect(jamOf(traffic, W, 200)).toEqual({ jammed: 2, jamAt: { x: 3, y: 0 } });
    expect(jamOf(new Map(), W, 200)).toEqual({ jammed: 0 });
  });
});

// Maddy 2026-10-07 (first look): arrests every few seconds flooded the ticker. They're gathered and reported at most
// every ARREST_NEWS_EVERY samples.
import { arrestBatch, ARREST_NEWS_EVERY } from '../../src/app/news';
describe('arrests are gathered, not reported one by one', () => {
  it('holds arrests until the batch is due, then hands them all over', () => {
    let held: { x: number; y: number }[] = [];
    let out: { x: number; y: number }[] = [];
    for (let s = 1; s < ARREST_NEWS_EVERY; s++) {
      [held, out] = arrestBatch(held, [{ x: s, y: s }], s);
      expect(out).toEqual([]);
    }
    [held, out] = arrestBatch(held, [{ x: 9, y: 9 }], ARREST_NEWS_EVERY);
    expect(out.length).toBe(ARREST_NEWS_EVERY);
    expect(held).toEqual([]);
  });
});
