// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { TagInput, FieldSuggestion, FormField } from '@/components/ds/inputs';
import { cleanTag, tagKey, tagTitleOverlap } from '@/lib/etsy/seoRules';
import { renderDs, cleanup, LOCALES } from './m1b-harness';
import { m1bInputs } from './m1b-messages';

afterEach(cleanup);

function Tags(props: Partial<React.ComponentProps<typeof TagInput>> & { initial?: string[] }) {
  const [tags, setTags] = useState<string[]>(props.initial ?? []);
  return (
    <FormField label="Tags" counter={{ value: tags.length, max: 13 }}>
      <TagInput value={tags} onChange={setTags} max={13} maxLength={20} {...props} />
    </FormField>
  );
}

describe.each(LOCALES)('TagInput (%s)', (locale) => {
  const msg = m1bInputs[locale].tagInput as Record<string, string>;

  it('adds on Enter and comma, shows per-chip counters, removes with the chip button', () => {
    renderDs(<Tags />, locale);
    const input = screen.getByLabelText('Tags') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'baby gift' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'newborn gift,wooden bo' } });
    expect(input.value).toBe('wooden bo');
    expect(screen.getByText('baby gift')).toBeTruthy();
    expect(screen.getByText('newborn gift')).toBeTruthy();
    expect(screen.getByText('9/20')).toBeTruthy();
    expect(screen.getByText('2 / 13')).toBeTruthy();
    const removeName = msg.remove.replace('{tag}', 'baby gift');
    fireEvent.click(screen.getByRole('button', { name: removeName }));
    expect(screen.queryByText('baby gift')).toBeNull();
  });

  it('too long: not added, error names the length, text stays in the input', () => {
    renderDs(<Tags />, locale);
    const input = screen.getByLabelText('Tags') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'personalized baby blanket' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toContain('25 / 20');
    expect(input.value).toBe('personalized baby blanket');
  });

  it('paste of a list adds the valid ones and shows one summary line with Show', () => {
    renderDs(<Tags initial={['baby gift']} />, locale);
    const input = screen.getByLabelText('Tags');
    fireEvent.paste(input, { clipboardData: { getData: () => 'newborn gift, personalized baby blanket, baby gift, nursery decor' } });
    expect(screen.getByText('nursery decor')).toBeTruthy();
    const summary = screen.getByText((_, el) => el?.tagName === 'SPAN' && /2/.test(el.textContent ?? '') && (el.textContent ?? '').includes(locale === 'en' ? 'Not added' : 'Eklenmeyen'));
    expect(summary).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: msg.show }));
    expect(screen.getAllByRole('listitem').length).toBe(2);
  });

  it('over the limit: the 14th tag is refused with the limit message', () => {
    const initial = Array.from({ length: 13 }, (_, i) => `tag number ${i}`);
    renderDs(<Tags initial={initial} />, locale);
    const input = screen.getByLabelText('Tags');
    fireEvent.change(input, { target: { value: 'one more' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toContain('13');
  });

  it('per-tag validation rejects on add and flags an existing chip; overlap gets a warning flag', () => {
    const { container } = renderDs(
      <Tags
        initial={['blanket for baby', 'bad#tag']}
        validate={(t) => (/#/.test(t) ? 'No # in tags' : null)}
        flagOverlapWith="Personalized Baby Blanket, Custom Name"
        overlap={tagTitleOverlap}
        normalize={cleanTag}
        tagKey={tagKey}
        singleWordHint
      />,
      locale,
    );
    expect(container.querySelector('[data-tag="bad#tag"]')?.getAttribute('data-flag')).toBe('danger');
    expect(container.querySelector('[data-tag="blanket for baby"]')?.getAttribute('data-flag')).toBe('warning');
    const input = screen.getByLabelText('Tags');
    fireEvent.change(input, { target: { value: 'Baby for Blanket' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toContain('blanket');
  });

  it('Backspace on an empty input arms then removes the last chip', () => {
    renderDs(<Tags initial={['one tag', 'two tag']} />, locale);
    const input = screen.getByLabelText('Tags');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(screen.getByText('two tag')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(screen.queryByText('two tag')).toBeNull();
  });

  it('suggestions: "+ tag" adds one, "Add all that fit" fills free slots, parent callbacks win', () => {
    const initial = Array.from({ length: 11 }, (_, i) => `tag number ${i}`);
    renderDs(<Tags initial={initial} suggestions={['newborn gift', 'baby shower', 'nursery decor']} />, locale);
    fireEvent.click(screen.getByRole('button', { name: msg.addSuggestion.replace('{tag}', 'newborn gift') }));
    expect(screen.getByText('12 / 13')).toBeTruthy();
    fireEvent.click(screen.getByText(msg.addAll));
    expect(screen.getByText('13 / 13')).toBeTruthy();
    cleanup();
    const one = vi.fn(); const all = vi.fn();
    renderDs(<Tags suggestions={['a gift', 'b gift']} onAcceptSuggestion={one} onAcceptAll={all} />, locale);
    fireEvent.click(screen.getByRole('button', { name: msg.addSuggestion.replace('{tag}', 'a gift') }));
    fireEvent.click(screen.getByText(msg.addAll));
    expect(one).toHaveBeenCalledWith('a gift');
    expect(all).toHaveBeenCalled();
    expect(screen.getByText('0 / 13')).toBeTruthy();
  });
});

describe.each(LOCALES)('FieldSuggestion (%s)', (locale) => {
  const msg = m1bInputs[locale].suggestion as Record<string, string>;
  it('shows the value, counter and basis; Use / Dismiss / Try again', () => {
    const use = vi.fn(); const dismiss = vi.fn(); const retry = vi.fn();
    renderDs(
      <FieldSuggestion
        value="Personalized Baby Blanket, Custom Name Blanket"
        counter={{ value: 46, max: 140 }}
        basis="Based on 48 Etsy listings"
        onUse={use}
        onDismiss={dismiss}
        onRetry={retry}
      />,
      locale,
    );
    expect(screen.getByRole('region', { name: msg.label })).toBeTruthy();
    expect(screen.getByText('46 / 140')).toBeTruthy();
    expect(screen.getByText('Based on 48 Etsy listings')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: msg.use }));
    fireEvent.click(screen.getByRole('button', { name: msg.dismiss }));
    fireEvent.click(screen.getByRole('button', { name: msg.retry }));
    expect(use).toHaveBeenCalled(); expect(dismiss).toHaveBeenCalled(); expect(retry).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: msg.use }).className).toContain('MuiButton-outlined');
  });
  it('loading says "Writing…" and disables Use; error hides Use and shows the inline line; arrays render chips', () => {
    renderDs(<FieldSuggestion value="" loading onUse={() => undefined} onDismiss={() => undefined} onRetry={() => undefined} />, locale);
    expect(screen.getAllByText(msg.writing).length).toBeGreaterThan(0);
    cleanup();
    renderDs(<FieldSuggestion value="x" error onUse={() => undefined} onDismiss={() => undefined} onRetry={() => undefined} credits={1} />, locale);
    expect(screen.getByRole('alert').textContent).toBe(msg.error);
    expect(screen.queryByRole('button', { name: msg.use })).toBeNull();
    cleanup();
    renderDs(<FieldSuggestion value={['newborn gift', 'baby shower']} useLabel="Use all" onUse={() => undefined} onDismiss={() => undefined} onRetry={() => undefined} />, locale);
    expect(screen.getByText('baby shower')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use all' })).toBeTruthy();
  });
});
