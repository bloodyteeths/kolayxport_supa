// messages G3 — pure rules: saved-reply validation/import (§6.4) and variable filling (§2.4).
import { describe, expect, it } from 'vitest';
import {
  SAVED_REPLY_BODY_MAX,
  SAVED_REPLY_LIMIT,
  SAVED_REPLY_TITLE_MAX,
  buildImportRows,
  parseLegacySavedReplies,
  repliesForPlatform,
  sortSavedReplies,
  validateSavedReplyInput,
  validateSavedReplyPatch,
} from '@/lib/messages/savedReplies';
import { fillVariables, findUnfilledTokens, firstName, insertAtCaret } from '@/lib/messages/fillVariables';

describe('validateSavedReplyInput', () => {
  it('trims and defaults platform to all stores', () => {
    expect(validateSavedReplyInput({ title: '  Shipping time ', body: ' Hi {customer}\n', platform: 'all' })).toEqual({
      ok: true,
      value: { title: 'Shipping time', body: 'Hi {customer}', platform: null },
    });
  });
  it('rejects empty, too long and unknown platform', () => {
    expect(validateSavedReplyInput({ title: '', body: 'x' })).toMatchObject({ ok: false, error: { field: 'title', reason: 'required' } });
    expect(validateSavedReplyInput({ title: 'x'.repeat(SAVED_REPLY_TITLE_MAX + 1), body: 'x' })).toMatchObject({ ok: false, error: { field: 'title', reason: 'tooLong', max: 60 } });
    expect(validateSavedReplyInput({ title: 'a', body: 'x'.repeat(SAVED_REPLY_BODY_MAX + 1) })).toMatchObject({ ok: false, error: { field: 'body', reason: 'tooLong', max: 1000 } });
    expect(validateSavedReplyInput({ title: 'a', body: 'b', platform: 'etsy' })).toMatchObject({ ok: false, error: { field: 'platform' } });
  });
  it('patch needs at least one field and validates only what is sent', () => {
    expect(validateSavedReplyPatch({})).toMatchObject({ ok: false });
    expect(validateSavedReplyPatch({ platform: 'wix' })).toEqual({ ok: true, value: { platform: 'wix' } });
    expect(validateSavedReplyPatch({ body: '   ' })).toMatchObject({ ok: false, error: { field: 'body', reason: 'required' } });
  });
});

describe('legacy import', () => {
  it('parses only a JSON string array', () => {
    expect(parseLegacySavedReplies('["a"," ",3,"b"]')).toEqual(['a', 'b']);
    expect(parseLegacySavedReplies('{"a":1}')).toEqual([]);
    expect(parseLegacySavedReplies('not json')).toEqual([]);
    expect(parseLegacySavedReplies(null)).toEqual([]);
  });
  it('titles are the first 40 characters, de-duplicated; identical texts once; capped', () => {
    const long = 'Merhaba, siparişiniz 1–3 iş günü içinde kargoya verilir. Teşekkürler!';
    const rows = buildImportRows([long, long, `${long.slice(0, 40)} farklı son`, 'Kısa\nmetin', 7]);
    expect(rows.map((r) => r.title)).toEqual([long.slice(0, 40).trim(), `${long.slice(0, 40).trim()} (2)`, 'Kısa metin']);
    expect(rows[2].body).toBe('Kısa\nmetin');
    expect(rows.every((r) => r.platform === null)).toBe(true);
    expect(buildImportRows(Array.from({ length: 80 }, (_, i) => `t${i}`))).toHaveLength(SAVED_REPLY_LIMIT);
    expect(buildImportRows('nope')).toEqual([]);
  });
});

describe('ordering and platform filter', () => {
  const rows = [
    { id: '1', title: 'Şipariş', usageCount: 2, platform: null },
    { id: '2', title: 'Beden', usageCount: 9, platform: 'trendyol' as const },
    { id: '3', title: 'Teşekkür', usageCount: 2, platform: 'wix' as const },
    { id: '4', title: 'Kargo', usageCount: 2, platform: null },
  ];
  it('most used first, then title', () => {
    expect(sortSavedReplies(rows).map((r) => r.id)).toEqual(['2', '4', '1', '3']);
  });
  it('all-stores replies plus the thread platform', () => {
    expect(repliesForPlatform(rows, 'wix').map((r) => r.id)).toEqual(['1', '3', '4']);
    expect(repliesForPlatform(rows, 'trendyol').map((r) => r.id)).toEqual(['1', '2', '4']);
  });
});

describe('fillVariables', () => {
  it('fills customer first name, product and order number', () => {
    const r = fillVariables('Merhaba {customer}, {product} siparişiniz {order} kargoda. {customer}', {
      customerName: 'Mehmet Y.',
      productTitle: 'Ahşap Kutu',
      orderNumber: '10482',
    });
    expect(r).toEqual({ text: 'Merhaba Mehmet, Ahşap Kutu siparişiniz #10482 kargoda. Mehmet', unfilled: [] });
  });
  it('leaves tokens without data and reports them once', () => {
    const r = fillVariables('Hi {customer}, order {order} / {order}', { customerName: '  ', orderNumber: null });
    expect(r.text).toBe('Hi {customer}, order {order} / {order}');
    expect(r.unfilled).toEqual(['customer', 'order']);
    expect(findUnfilledTokens(r.text)).toEqual(['{customer}', '{order}']);
    expect(findUnfilledTokens('no {unknown} tokens')).toEqual([]);
  });
  it('keeps a leading # on order numbers', () => {
    expect(fillVariables('{order}', { orderNumber: '#77' }).text).toBe('#77');
    expect(firstName('')).toBe('');
  });
});

describe('insertAtCaret', () => {
  it('replaces the selection', () => {
    expect(insertAtCaret('Hello world', 'there', 6, 11)).toEqual({ text: 'Hello there', caret: 11 });
  });
  it('appends on a new line without a caret or with the caret at the end', () => {
    expect(insertAtCaret('Hello', 'Reply')).toEqual({ text: 'Hello\nReply', caret: 11 });
    expect(insertAtCaret('Hello', 'Reply', 5, 5)).toEqual({ text: 'Hello\nReply', caret: 11 });
    expect(insertAtCaret('', 'Reply')).toEqual({ text: 'Reply', caret: 5 });
  });
  it('inline token insert at the end does not add a line', () => {
    expect(insertAtCaret('Hi ', '{customer}', 3, 3, { newLineWhenAppending: false })).toEqual({ text: 'Hi {customer}', caret: 13 });
  });
});
