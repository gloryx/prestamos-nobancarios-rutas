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
    expect(css).toContain('.wallet-components { grid-template-columns: minmax(0, 1fr); }');
    expect(css).toContain('.wallet-movement { grid-template-columns: minmax(0, 1fr) auto;');
    expect(css).toContain('.wallet-movement__detail { grid-column: 1 / -1; grid-row: 2; }');
    expect(css).toContain('.wallet-balance__amount');
  });

  it('stacks receipt actions and recipient details for phone screens', () => {
    expect(css).toContain('.stage3b--collector .precollection-receipt-actions__buttons { display: grid;');
    expect(css).toContain('.stage3b--collector .precollection-receipt-actions__buttons .button { width: 100%; }');
    expect(css).toContain('.precollection-share-dialog .stage3b__detail { grid-template-columns: minmax(0, 1fr); }');
  });

  it('stacks settlement detail cards and actions in a phone-height dialog', () => {
    expect(css).toContain('.settlement-detail__items {');
    expect(css).toContain('grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));');
    expect(css).toContain('.dialog.settlement-detail-dialog { width: 100%; max-height: calc(100dvh - .5rem);');
    expect(css).toContain('.settlement-detail__items { grid-template-columns: minmax(0, 1fr); }');
    expect(css).toContain('.settlement-detail__actions { display: grid; grid-template-columns: minmax(0, 1fr); }');
  });
});
