// Drone deliveries (interdependence §3, step 4b): an AI node is a dispatch hub — with Drone Deliveries, a driven
// shopping errand from a home within DRONE_RADIUS of a node is delivered instead, and a drone flies it: from the node
// to the home and back, in a straight line at roof height. Beyond any node's reach, errands are driven as before.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { createAmbientState } from '../../src/live/types';
import { droneHub, launchDrone, stepDrones, DRONE_CAP, DRONE_RADIUS } from '../../src/live/drones';

function town() {
  const map = new GameMap(60, 20);
  const parcels = new ParcelStore();
  placeParcel(map, parcels, { x: 10, y: 8, width: 2, height: 2, kind: BuiltKind.AINode });
  return { map, state: createAmbientState() };
}

describe('drone deliveries', () => {
  it('a home within DRONE_RADIUS of an AI node has a hub; one beyond has none', () => {
    const t = town();
    expect(droneHub(t.map, 10 + DRONE_RADIUS, 8)).not.toBeNull();
    expect(droneHub(t.map, 11 + DRONE_RADIUS + 4, 8)).toBeNull();
  });
  it('a drone flies from the hub to the home, back, and is gone', () => {
    const t = town();
    const hub = droneHub(t.map, 20, 8)!;
    launchDrone(t.state, hub, { x: 20, y: 8 });
    expect(t.state.drones).toHaveLength(1);
    let reached = false;
    for (let k = 0; k < 5000 && (t.state.drones?.length ?? 0) > 0; k++) {
      stepDrones(t.state);
      const d = t.state.drones?.[0];
      if (d && Math.abs(d.x - 20) < 0.5 && Math.abs(d.y - 8) < 0.5) reached = true;
    }
    expect(reached).toBe(true);
    expect(t.state.drones ?? []).toHaveLength(0);
  });
  it('never more than DRONE_CAP in the air', () => {
    const t = town();
    const hub = droneHub(t.map, 20, 8)!;
    for (let k = 0; k < DRONE_CAP + 5; k++) launchDrone(t.state, hub, { x: 20, y: 8 });
    expect(t.state.drones).toHaveLength(DRONE_CAP);
  });
});
