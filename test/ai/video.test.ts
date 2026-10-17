import { describe, expect, it } from 'vitest';
import { classifyVideoFilter } from "@/lib/ai/video";
import { isUnsafeUrl } from '@/lib/ai/safeUrl';

describe('AI video', () => {
  it('child-photo refusals get their own reason (shown with what to do)', () => {
    expect(classifyVideoFilter(["Sorry, we can't create videos from input images containing photorealistic children."])).toBe('videoChildPhoto');
    expect(classifyVideoFilter(['unsafe content'])).toBe('videoFiltered');
  });
  it('only fetches public https images', () => {
    expect(isUnsafeUrl('https://i.etsystatic.com/x.jpg')).toBe(false);
    expect(isUnsafeUrl('http://i.etsystatic.com/x.jpg')).toBe(true);
    expect(isUnsafeUrl('https://127.0.0.1/x')).toBe(true);
    expect(isUnsafeUrl('https://10.0.0.5/x')).toBe(true);
  });
});
