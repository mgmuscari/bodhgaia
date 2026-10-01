// The economy's top-bar readout (PURE — pure-ui allowlist): funds and their hourly trend, communal effort
// against the city's capacity to hold it, approval and trust — and burnout, only when people are tired.

export interface EconomyReadout {
  funds: number;
  fundsPerHour: number;
  effort: number;
  capacity: number;
  approval: number;
  goodwill: number;
  burnout: number;
}

const MINUS = '−';
const money = (v: number): string => `${v < 0 ? MINUS : ''}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;

export function economyLine(r: EconomyReadout): string {
  const trend = Math.round(r.fundsPerHour);
  const parts = [
    `${money(r.funds)} (${trend < 0 ? MINUS : '+'}${Math.abs(trend)}/h)`,
    `Effort ${Math.floor(r.effort)}/${Math.floor(r.capacity)}`,
    `Approval ${Math.round(r.approval)}%`,
    `Trust ${Math.round(r.goodwill)}`,
  ];
  if (r.burnout >= 0.1) parts.push(`Tired ${Math.round(r.burnout * 100)}%`);
  return parts.join('  ·  ');
}
