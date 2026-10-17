import { describe, expect, it } from 'vitest';
import { classifyVideoFilter, videoPrompt } from '@/lib/ai/video';
import { isUnsafeUrl } from '@/lib/ai/safeUrl';

describe('AI video', () => {
  it('child-photo refusals get their own reason (shown with what to do)', () => {
    expect(classifyVideoFilter(["Sorry, we can't create videos from input images containing photorealistic children."])).toBe('videoChildPhoto');
    expect(classifyVideoFilter(['unsafe content'])).toBe('videoFiltered');
  });
  it('follow-ups add numbered changes to the original description', () => {
    const p = videoPrompt('camera circles the dress', ['slower motion', 'closer shot']);
    expect(p).toMatch(/camera circles the dress[\s\S]*Change 1: slower motion[\s\S]*Change 2: closer shot/);
    expect(p).toMatch(/Keep the product exactly as in the photo/);
  });
  it('only fetches public https images', () => {
    expect(isUnsafeUrl('https://i.etsystatic.com/x.jpg')).toBe(false);
    expect(isUnsafeUrl('http://i.etsystatic.com/x.jpg')).toBe(true);
    expect(isUnsafeUrl('https://127.0.0.1/x')).toBe(true);
    expect(isUnsafeUrl('https://10.0.0.5/x')).toBe(true);
  });
});
