import { isCurrentSourceHealthGeneration } from '../src/services/sourceHealthGeneration';

describe('source health generation', () => {
  it('rejects an old probe after a source configuration change', () => {
    expect(isCurrentSourceHealthGeneration(3, 4)).toBe(false);
    expect(isCurrentSourceHealthGeneration(4, 4)).toBe(true);
    expect(isCurrentSourceHealthGeneration(4, 4, true)).toBe(false);
  });
});
