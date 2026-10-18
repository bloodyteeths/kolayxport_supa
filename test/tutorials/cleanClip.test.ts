import { describe, it, expect } from 'vitest';
// @ts-expect-error plain ESM script without types
import { speechWindow } from '../../scripts/tutorials/cleanClip.mjs';

describe('narration edge clean-up (Gemini TTS click + trailing static burst)', () => {
  it('drops a 10 ms leading click and a 130 ms trailing burst after a pause', () => {
    const w = speechWindow([{ from: 0, to: 0.01 }, { from: 0.34, to: 8.95 }, { from: 9.65, to: 9.78 }]);
    expect(w.start).toBeCloseTo(0.31, 2);
    expect(w.end).toBeCloseTo(9.03, 2);
  });
  it('keeps a real final word that follows the sentence without a long pause', () => {
    expect(speechWindow([{ from: 0.3, to: 5.0 }, { from: 5.08, to: 5.3 }])).toBeNull();
  });
  it('keeps a long final phrase after a pause', () => {
    expect(speechWindow([{ from: 0.3, to: 4.0 }, { from: 4.5, to: 5.6 }])).toBeNull();
  });
});
