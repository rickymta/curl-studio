import { describe, expect, it } from 'vitest';

import { placeLabels } from './charts';

describe('placeLabels', () => {
  it('puts close labels on different rows and far ones on the first row', () => {
    const out = placeLabels(
      [
        { x: 100, label: 'p50 1.5 ms' },
        { x: 120, label: 'p95 3.0 ms' },
        { x: 126, label: 'p99 3.7 ms' },
        { x: 400, label: 'p99.9 9 ms' },
      ],
      800,
    );
    const row = Object.fromEntries(out.map((o) => [o.label, o.row]));
    expect(row['p50 1.5 ms']).toBe(0);
    expect(row['p95 3.0 ms']).toBe(1);
    expect(row['p99 3.7 ms']).toBe(2);
    expect(row['p99.9 9 ms']).toBe(0);
  });

  it('flips labels at the right edge to the left of their line', () => {
    const [o] = placeLabels([{ x: 790, label: 'p99 30 ms' }], 800);
    expect(o!.anchor).toBe('end');
    expect(o!.lx).toBeLessThan(790);
  });
});
