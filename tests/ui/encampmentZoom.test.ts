// Encampments are visible at the farthest zoom (Maddy 2026-10-08): the tents are people, and displacement is
// the thing the city should not be able to zoom away from.
import { describe, expect, it } from 'vitest';
import { encampmentsShown } from '../../src/ui/renderer';
import { MIN_ZOOM, MAX_ZOOM } from '../../src/ui/camera';

describe('encampments at every zoom', () => {
  it('drawn from the farthest zoom to the nearest, whenever the tent art is loaded', () => {
    for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) expect(encampmentsShown(z, true), `zoom ${z}`).toBe(true);
  });
  it('not before the art has loaded', () => {
    expect(encampmentsShown(MIN_ZOOM, false)).toBe(false);
  });
});
