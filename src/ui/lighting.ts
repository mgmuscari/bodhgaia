// Shared scene LIGHTING — the day/night sun and the in-game clock on its wall clock. The GPU shader
// applies the day/night dim to the base tiles; the renderer applies the IDENTICAL curve to the Canvas2D
// sprite layer, so a sprite is lit to the same level as the ground it stands on (Maddy 2026-06-20). The
// GLSL in satelliteShader.ts MIRRORS this — keep the two in sync (the unit tests pin the numbers).
// IO-free + pure (Math.sin is fine here — this module is NOT on the pure-ui allowlist). Time is seconds.

export const DAYSPEED = 0.04; // sun-arc rate (full day/night ≈ 2π/DAYSPEED ≈ 157s); shared with the shader
const NIGHT_FLOOR = 0.45; // darkest the scene gets at night (never fully black)

/**
 * The in-game clock on the same wall clock as the sun: t = 0 is sunrise (06:00, altitude rising through
 * zero), a quarter-day later is noon. `slot` counts whole in-game hours since load (monotonic) — the
 * power grid's demand draws and blackout rotation key off it.
 */
export function gameClock(tSec: number): { hour: number; slot: number } {
  const slot = Math.floor((tSec * DAYSPEED * 24) / (2 * Math.PI));
  return { hour: (slot + 6) % 24, slot };
}

/** Day/night brightness 0.45..1 — altitude = sin(day); dims/brightens via smoothstep, like the shader. */
export function dayNightBrightness(tSec: number): number {
  const alt = Math.sin(tSec * DAYSPEED);
  const t = clamp01((alt + 0.2) / 0.5); // smoothstep(-0.2, 0.3, alt)
  return NIGHT_FLOOR + (1 - NIGHT_FLOOR) * (t * t * (3 - 2 * t));
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
