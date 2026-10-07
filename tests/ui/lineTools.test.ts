import { describe, it, expect } from 'vitest';
import { toolDef } from '../../src/tools/tools';
import { isLineTool } from '../../src/ui/lineTools';

// isLineTool is the pure predicate over a ToolDef that main.ts's drag wiring
// consumes: a LINE tool drag-paints (transport build/convert, kinds ≤15); every
// other tool is point-apply (building build AND building convert, inspect,
// bulldoze). Pure module (on the pure-ui allowlist) so it is unit-tested rather
// than left to main.ts wiring. Line iff the tool produces a transport kind.

describe('isLineTool', () => {
  it('classifies transport build/convert as line tools (keep drag-paint)', () => {
    expect(isLineTool(toolDef('convert-1')!), 'convert-1').toBe(true); // avenue road diet
    expect(isLineTool(toolDef('convert-6')!), 'convert-6').toBe(true); // rail -> streetcar
    expect(isLineTool(toolDef('build-5')!), 'build-5').toBe(true); // bike-path build
  });

  it('classifies building converts as point tools (point-plop, not mass-rezone)', () => {
    expect(isLineTool(toolDef('convert-61')!), 'convert-61').toBe(false);
    expect(isLineTool(toolDef('convert-62')!), 'convert-62').toBe(false);
  });

  it('classifies building builds as point tools (regression — already point)', () => {
    expect(isLineTool(toolDef('build-49')!), 'build-49').toBe(false); // Community Garden 2x2
  });

  it('classifies inspect as a point tool (no kind)', () => {
    expect(isLineTool(toolDef('inspect')!), 'inspect').toBe(false);
  });

  // Maddy 2026-10-07 (reversing the earlier point-only decision): "click to drag to bulldoze should work, but only
  // in a straight line, not a box" — bulldoze drag-paints a straight run (lineTiles snaps to the major axis).
  it('classifies bulldoze as a line tool: a drag clears a straight run', () => {
    expect(isLineTool(toolDef('bulldoze')!), 'bulldoze').toBe(true);
  });
});
