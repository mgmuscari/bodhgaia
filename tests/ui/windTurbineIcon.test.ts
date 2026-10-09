// Maddy 2026-10-08: "the windmill icon in the menu bar has no blades". Since the rotors turn (a sprite over the tower,
// drawn by the renderer), the turbine's own tile is bladeless; the menu showed that tile. Its icon is the tower with a
// rotor frame on the hub, where the renderer puts it.
import { describe, expect, it } from 'vitest';
import { paintSnesTileset } from '../../src/ui/snesTileset';
import { toolArt, buildToolMenu } from '../../src/ui/toolMenuContent';
import { toolDef } from '../../src/tools/tools';
import { BuiltKind } from '../../src/engine/fabric';
import { footprintCellKey } from '../../src/ui/renderKey';
import { C } from '../../src/ui/snesPalette';

const tiles = paintSnesTileset();

describe('the wind turbine’s icon has its blades', () => {
  it('the icon is the tower with a rotor on its hub', () => {
    const icon = tiles.get('@ui/wind-turbine')!;
    const tower = tiles.get(footprintCellKey(BuiltKind.WindTurbine, 1, 1, 0, 0, 0))!;
    const rotor = tiles.get('@sprite/turbine-rotor/0')!;
    expect(icon).toBeDefined();
    const [lr, lg, lb] = C.line;
    // every blade pixel of the rotor shows in the icon, offset onto the hub (8.5, 6.5 art px)
    let blades = 0;
    for (let y = 0; y < rotor.h; y++)
      for (let x = 0; x < rotor.w; x++) {
        const i = (y * rotor.w + x) * 4;
        if (rotor.data[i + 3] === 0 || rotor.data[i] !== lr) continue;
        const j = ((y + 1) * icon.w + (x + 3)) * 4;
        expect([icon.data[j], icon.data[j + 1], icon.data[j + 2]]).toEqual([lr, lg, lb]);
        blades++;
      }
    expect(blades).toBeGreaterThan(6);
    expect(icon.data).not.toEqual(tower.data);
  });

  it('the tool and the energy category both show it', () => {
    expect(toolArt(toolDef(`build-${BuiltKind.WindTurbine}`)!)).toBe('@ui/wind-turbine');
    const menu = buildToolMenu([toolDef(`build-${BuiltKind.WindTurbine}`)!], null, 1e9, null);
    expect(menu.categories.find((c) => c.id === 'energy')?.art).toBe('@ui/wind-turbine');
  });
});
