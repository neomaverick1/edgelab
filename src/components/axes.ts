import type { Tunable } from '../lib/rules';

export interface AxisCfg {
  id: string;
  min: number;
  max: number;
  steps: number;
}

export const defaultAxis = (t: Tunable): AxisCfg => {
  const span = Math.max(t.step * 4, Math.abs(t.value) * 0.6);
  const snap = (v: number) => +(Math.round(v / t.step) * t.step).toFixed(4);
  const min = Math.max(t.min, snap(t.value - span));
  const max = Math.min(t.max, snap(t.value + span));
  return { id: t.id, min, max, steps: 9 };
};
