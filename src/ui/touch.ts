// Touch-screen detection (DOM): a device whose main pointer is a finger and that can't hover — a phone or tablet, not a
// laptop that merely has a touchscreen. Such a device has no keyboard to speak of, so the game shows no shortcut keys
// on it (Maddy 2026-10-08).

export function touchScreen(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}
