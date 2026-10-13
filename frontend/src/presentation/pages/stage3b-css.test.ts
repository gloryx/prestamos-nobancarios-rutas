import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Stage 3B responsive CSS contract', () => {
  const css = readFileSync(new URL('../../shared/styles.css', import.meta.url), 'utf8');
  it('provides a 320px-safe collector card layout without requiring a horizontal table', () => {
    expect(css).toContain('@media (max-width: 380px)');
    expect(css).toContain('.stage3b--collector .stage3b-card');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(css).toContain('min-height: 2.75rem');
  });

  it('stacks wallet activity and movement details at the narrow breakpoint', () => {
    expect(css).toContain('.wallet-activity { grid-template-columns: minmax(0, 1fr); }');
    expect(css).toContain('.wallet-movement { grid-template-columns: minmax(0, 1fr) auto;');
    expect(css).toContain('.wallet-movement__detail { grid-column: 1 / -1; grid-row: 2; }');
    expect(css).toContain('.wallet-balance__amount');
  });
});
