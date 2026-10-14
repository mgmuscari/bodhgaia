// How people are getting around, for the indicators (interdependence §8).
import { describe, expect, it } from 'vitest';
import { createAmbientState, type Mover } from '../../src/live/types';
import { TravelMode } from '../../src/citizens/modes';
import { travelModes } from '../../src/live/stats';

describe('travelModes', () => {
  it('counts the people out by how they travel — not those inside — and passing traffic as cars', () => {
    const s = createAmbientState();
    const ped = (o: Partial<Mover>) => ({ x: 0, y: 0, dir: 0, tx: 0, ty: 0, ...o }) as Mover;
    s.peds.push(ped({ mode: TravelMode.Walk }), ped({ mode: TravelMode.Bike }), ped({ phase: 'riding' }), ped({ phase: 'driving' }), ped({ phase: 'inside' }));
    s.cars.push(ped({}), ped({ parked: true }), ped({ owned: true }));
    expect(travelModes(s)).toEqual({ walk: 1, bike: 1, transit: 1, car: 2 });
  });
});
