// components/ds/inputs/TagInput.tsx — DS §3.7 + listing-editor §4.2/§4.6.
// Comma/Enter entry, list paste with one summary line, per-chip counter, per-tag validation (rejects on add,
// flags existing chips), title-overlap flag, single-word hint, AI suggestion chips ("+ tag", "Add all that fit").
// Marketplace rules are injected (Etsy passes `normalize=cleanTag`, `tagKey`, `overlap=tagTitleOverlap` from
// lib/etsy/seoRules) so no rule is re-implemented here.
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Tooltip from '@mui/material/Tooltip';
import { useTranslations } from 'next-intl';
import { neutral, accent, tone, radius, focusRing, motion, type as typeScale } from '@/lib/ds/tokens';
import { COARSE, chipBaseSx, focusVisibleSx, hitSlopAfter, hitSlopSx, useFieldContext, useIntlLocale, fmtInt } from './_shared';
import { IconClose, IconAdd, IconHelp, IconError, ICON_STROKE } from './_icons';
import type { DsBaseProps } from './types';

export type TagRejectReason = 'too_long' | 'duplicate' | 'invalid' | 'over_limit';
export interface TagRejection { tag: string; reason: TagRejectReason; message?: string }

export interface TagInputProps extends DsBaseProps {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Max tag count (Etsy 13). Omit for no limit (Shopify). */
  max?: number;
  /** Max characters per tag (Etsy 20, materials 45, Shopify 255). */
  maxLength?: number;
  /** Characters that split input, plus 'Enter'. Default [',', 'Enter']. Newlines/tabs always split a paste. */
  separators?: string[];
  /** Per-tag rule: a message rejects the tag on add and flags an existing chip. */
  validate?: (tag: string) => string | null;
  /** Title text; chips sharing a word with it get a warning dot + tooltip. */
  flagOverlapWith?: string;
  /** Overlap finder (Etsy: `tagTitleOverlap`). Default: case-insensitive word match, words ≥ 3 letters. */
  overlap?: (tag: string, text: string) => string[];
  /** Cleans one raw entry (Etsy: `cleanTag`). Default: trim + collapse spaces. */
  normalize?: (raw: string) => string;
  /** Duplicate key (Etsy: `tagKey`). Default: lower-case in the UI locale. */
  tagKey?: (tag: string) => string;
  /** Show the neutral "(?) two- or three-word tags" hint on one-word chips (Etsy). */
  singleWordHint?: boolean;
  /** Chips to highlight (ScorePanel "Show weak tags"). */
  flagged?: string[];
  /** listing-editor §4.6: AI tag ideas rendered as "+ tag" chips under the field. */
  suggestions?: string[];
  /** When given, the parent adds the tag (and usually drops it from `suggestions`). Otherwise TagInput adds it. */
  onAcceptSuggestion?: (tag: string) => void;
  /** When given, the parent handles "Add all that fit". Otherwise TagInput adds up to the free slots. */
  onAcceptAll?: () => void;
  /** Replaces the default "{max} tags is the limit" message (e.g. "13 tags is Etsy's limit…"). */
  overLimitMessage?: string;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
}

const defaultNormalize = (raw: string) => raw.replace(/\s+/g, ' ').trim();
const defaultOverlap = (tag: string, text: string): string[] => {
  const words = new Set(text.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3));
  return tag.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && words.has(w));
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Pure merge used by the component (exported for tests and for BulkGrid's tag cell). */
export function mergeTags(
  existing: string[],
  pieces: string[],
  opts: { max?: number; maxLength?: number; validate?: (t: string) => string | null; normalize?: (r: string) => string; tagKey?: (t: string) => string },
): { tags: string[]; added: string[]; rejected: TagRejection[] } {
  const normalize = opts.normalize ?? defaultNormalize;
  const key = opts.tagKey ?? ((t: string) => t.toLocaleLowerCase());
  const tags = [...existing];
  const keys = new Set(existing.map((t) => key(t) || t));
  const added: string[] = [];
  const rejected: TagRejection[] = [];
  for (const raw of pieces) {
    if (!raw.trim()) continue;
    const tag = normalize(raw);
    if (!tag) { rejected.push({ tag: raw.trim(), reason: 'invalid' }); continue; }
    if (opts.maxLength != null && tag.length > opts.maxLength) { rejected.push({ tag, reason: 'too_long' }); continue; }
    const k = key(tag) || tag;
    if (keys.has(k)) { rejected.push({ tag, reason: 'duplicate' }); continue; }
    const msg = opts.validate?.(tag) ?? null;
    if (msg) { rejected.push({ tag, reason: 'invalid', message: msg }); continue; }
    if (opts.max != null && tags.length >= opts.max) { rejected.push({ tag, reason: 'over_limit' }); continue; }
    keys.add(k);
    tags.push(tag);
    added.push(tag);
  }
  return { tags, added, rejected };
}

export function TagInput({
  value, onChange, max, maxLength, separators = [',', 'Enter'], validate, flagOverlapWith, overlap = defaultOverlap,
  normalize, tagKey, singleWordHint, flagged, suggestions, onAcceptSuggestion, onAcceptAll, overLimitMessage, placeholder,
  id, invalid, disabled, className, 'data-testid': testId, 'aria-label': ariaLabel,
}: TagInputProps) {
  const t = useTranslations('ds.inputs.tagInput');
  const locale = useIntlLocale();
  const field = useFieldContext();
  const inputId = id ?? field?.id;
  const msgId = `${useId().replace(/:/g, '')}-tagmsg`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ added: number; rejected: TagRejection[] } | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const [armedLast, setArmedLast] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const charSeps = separators.filter((s) => s !== 'Enter');
  const splitRe = useMemo(() => new RegExp(`[${['\n', '\t', ...charSeps].map(escapeRe).join('')}]`), [charSeps.join('')]);
  const keyOf = tagKey ?? ((x: string) => x.toLocaleLowerCase());

  useEffect(() => {
    if (!flash) return undefined;
    const h = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(h);
  }, [flash]);

  const reasonMessage = (r: TagRejection) => {
    if (r.reason === 'too_long') return t('tooLong', { tag: r.tag, length: r.tag.length, max: maxLength ?? 0 });
    if (r.reason === 'duplicate') return t('duplicate', { tag: r.tag });
    if (r.reason === 'over_limit') return overLimitMessage ?? t('overLimit', { max: max ?? 0 });
    return r.message ?? t('invalid', { tag: r.tag });
  };

  const add = (pieces: string[], keepOnSingleError: boolean) => {
    const res = mergeTags(value, pieces, { max, maxLength, validate, normalize, tagKey });
    if (res.added.length) onChange(res.tags);
    const real = pieces.filter((p) => p.trim());
    if (real.length <= 1) {
      setSummary(null);
      const r = res.rejected[0];
      if (r) {
        setError(reasonMessage(r));
        if (r.reason === 'duplicate') {
          const k = keyOf(r.tag) || r.tag;
          setFlash(value.find((v) => (keyOf(v) || v) === k) ?? null);
        }
        if (keepOnSingleError && (r.reason === 'too_long' || r.reason === 'invalid')) return false;
      } else {
        setError(null);
      }
      return true;
    }
    setError(null);
    setShowRejected(false);
    setSummary(res.rejected.length ? { added: res.added.length, rejected: res.rejected } : null);
    return true;
  };

  const onInputChange = (v: string) => {
    setArmedLast(false);
    if (charSeps.some((s) => v.includes(s))) {
      const parts = v.split(splitRe);
      const rest = parts.pop() ?? '';
      // A single too-long/invalid tag ended by a separator stays in the input so it can be fixed (listing-editor §4.2).
      const real = parts.filter((p) => p.trim());
      if (!add(parts, real.length === 1 && !rest.trim())) { setText(real[0]); return; }
      setText(rest);
      return;
    }
    setText(v);
    if (error) setError(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && separators.includes('Enter')) {
      e.preventDefault();
      if (!text.trim()) return;
      if (add([text], true)) setText('');
      return;
    }
    if (e.key === 'Backspace' && text === '' && value.length > 0) {
      if (armedLast) {
        onChange(value.slice(0, -1));
        setArmedLast(false);
      } else {
        setArmedLast(true);
      }
      return;
    }
    if (e.key === 'Escape') { setText(''); setError(null); }
    setArmedLast(false);
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (!splitRe.test(pasted)) return;
    e.preventDefault();
    add((text + pasted).split(splitRe), false);
    setText('');
  };

  const remove = (tag: string) => {
    onChange(value.filter((v) => v !== tag));
    inputRef.current?.focus();
  };

  const valueKeys = new Set(value.map((v) => keyOf(v) || v));
  const visibleSuggestions = (suggestions ?? []).filter(
    (s) => !valueKeys.has(keyOf(s) || s) && (maxLength == null || s.length <= maxLength),
  );
  const free = max == null ? Infinity : Math.max(0, max - value.length);
  const acceptOne = (s: string) => {
    if (onAcceptSuggestion) onAcceptSuggestion(s);
    else add([s], false);
  };
  const acceptAll = () => {
    if (onAcceptAll) onAcceptAll();
    else add(visibleSuggestions.slice(0, free === Infinity ? undefined : free), false);
  };

  const summaryText = summary
    ? (() => {
        const counts: Record<TagRejectReason, number> = { too_long: 0, duplicate: 0, invalid: 0, over_limit: 0 };
        summary.rejected.forEach((r) => { counts[r.reason] += 1; });
        const details = (Object.keys(counts) as TagRejectReason[])
          .filter((k) => counts[k] > 0)
          .map((k) => t(`reason.${k}`, { count: counts[k] }))
          .join(', ');
        return t('summary', { added: summary.added, details });
      })()
    : null;

  const isInvalid = Boolean(invalid ?? field?.invalid) || Boolean(error);
  const flaggedSet = new Set(flagged ?? []);

  return (
    <Box className={className} data-testid={testId} sx={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
      <Box
        onClick={() => inputRef.current?.focus()}
        sx={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', minHeight: 40, p: '7px 8px',
          border: `1px solid ${isInvalid ? tone.danger.solid : neutral[300]}`, borderRadius: `${radius.sm}px`,
          backgroundColor: disabled ? neutral[50] : neutral[0], cursor: 'text',
          '&:hover': { borderColor: isInvalid ? tone.danger.solid : neutral[400] },
          '&:focus-within': { borderColor: isInvalid ? tone.danger.solid : accent[600], boxShadow: focusRing },
          [COARSE]: { minHeight: 44 },
        }}
      >
        {value.map((tag, i) => {
          const words = flagOverlapWith ? overlap(tag, flagOverlapWith) : [];
          const vMsg = validate?.(tag) ?? null;
          const tooLong = maxLength != null && tag.length > maxLength;
          const single = singleWordHint && tag.trim().split(/\s+/).length === 1;
          const ratio = maxLength ? tag.length / maxLength : 0;
          const armed = armedLast && i === value.length - 1;
          const hint = vMsg ?? (words.length ? t('overlap', { words: words.join(', ') }) : single ? t('singleWord') : null);
          const chip = (
            <Box
              component="span"
              data-tag={tag}
              data-flag={vMsg || tooLong ? 'danger' : words.length ? 'warning' : single ? 'hint' : undefined}
              sx={{
                ...chipBaseSx,
                ...(vMsg || tooLong ? { borderColor: tone.danger.solid, backgroundColor: tone.danger.bg } : null),
                ...(flaggedSet.has(tag) ? { borderColor: tone.warning.solid } : null),
                ...(flash === tag || armed ? { backgroundColor: accent[50], borderColor: accent[600] } : null),
                transition: `background-color ${motion.fast}ms ${motion.ease}, border-color ${motion.fast}ms ${motion.ease}`,
              }}
            >
              {words.length ? (
                <Box component="span" aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: tone.warning.solid, flexShrink: 0 }} />
              ) : null}
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</Box>
              {single && !words.length && !vMsg ? (
                <Box component="span" sx={{ display: 'inline-flex', color: neutral[500] }}><IconHelp size={12} strokeWidth={ICON_STROKE} aria-hidden /></Box>
              ) : null}
              {maxLength ? (
                <Box
                  component="span"
                  sx={{
                    fontSize: typeScale.micro[0], lineHeight: `${typeScale.micro[1]}px`, fontWeight: typeScale.micro[2], fontVariantNumeric: 'tabular-nums',
                    color: ratio > 1 ? tone.danger.fg : ratio >= 0.9 ? tone.warning.fg : neutral[500],
                  }}
                >
                  {t('chipCounter', { value: fmtInt(tag.length, locale), max: fmtInt(maxLength, locale) })}
                </Box>
              ) : null}
              {!disabled ? (
                <ButtonBase
                  aria-label={t('remove', { tag })}
                  onClick={(e) => { e.stopPropagation(); remove(tag); }}
                  sx={{
                    width: 18, height: 18, borderRadius: '50%', color: neutral[500], ...focusVisibleSx,
                    '&:hover': { backgroundColor: neutral[200], color: neutral[800] },
                    [COARSE]: { width: 28, height: 28, m: '-5px', ...hitSlopAfter },
                  }}
                >
                  <IconClose size={12} strokeWidth={ICON_STROKE} aria-hidden />
                </ButtonBase>
              ) : null}
            </Box>
          );
          return hint ? <Tooltip key={tag} title={hint}>{chip}</Tooltip> : <Box component="span" key={tag} sx={{ display: 'inline-flex', maxWidth: '100%' }}>{chip}</Box>;
        })}
        <Box
          component="input"
          ref={inputRef}
          id={inputId}
          value={text}
          disabled={disabled}
          placeholder={value.length === 0 ? placeholder ?? t('placeholder') : undefined}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => setArmedLast(false)}
          aria-label={ariaLabel}
          aria-invalid={isInvalid || undefined}
          aria-describedby={[field?.describedBy, error || summary ? msgId : null].filter(Boolean).join(' ') || undefined}
          sx={{
            flex: 1, minWidth: 120, border: 0, outline: 0, p: '2px 4px', fontSize: 14, lineHeight: '20px', color: neutral[800],
            backgroundColor: 'transparent', fontFamily: 'inherit', '&::placeholder': { color: neutral[400], opacity: 1 },
            [COARSE]: { fontSize: 16 },
          }}
        />
      </Box>

      {error ? (
        <Box id={msgId} role="alert" sx={{ display: 'flex', gap: '4px', alignItems: 'flex-start', fontSize: 12, lineHeight: '16px', color: tone.danger.fg }}>
          <Box component="span" sx={{ display: 'inline-flex', mt: '1px' }}><IconError size={14} strokeWidth={ICON_STROKE} aria-hidden /></Box>
          {error}
        </Box>
      ) : null}

      {summaryText ? (
        <Box id={msgId} aria-live="polite" sx={{ fontSize: 12, lineHeight: '16px', color: neutral[600] }}>
          <span>{summaryText}</span>
          <Box component="span" aria-hidden sx={{ mx: '4px' }}>{'·'}</Box>
          <ButtonBase onClick={() => setShowRejected((v) => !v)} aria-expanded={showRejected} sx={{ fontSize: 12, fontWeight: 500, color: accent[600], borderRadius: '4px', ...hitSlopSx, ...focusVisibleSx }}>
            {showRejected ? t('hide') : t('show')}
          </ButtonBase>
          {showRejected ? (
            <Box component="ul" sx={{ m: '4px 0 0', pl: '16px' }}>
              {summary?.rejected.map((r, i) => <li key={`${r.tag}-${i}`}>{reasonMessage(r)}</li>)}
            </Box>
          ) : null}
        </Box>
      ) : null}

      {visibleSuggestions.length > 0 ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }} aria-label={t('suggestions')} role="group">
          {visibleSuggestions.map((s) => (
            <ButtonBase
              key={s}
              onClick={() => acceptOne(s)}
              disabled={disabled || free === 0}
              aria-label={t('addSuggestion', { tag: s })}
              sx={{
                ...chipBaseSx, padding: '0 8px', borderStyle: 'dashed', borderColor: accent[200], backgroundColor: neutral[0], color: accent[700],
                ...focusVisibleSx, '&:hover': { backgroundColor: accent[50] }, '&.Mui-disabled': { color: neutral[400], borderColor: neutral[200] },
                [COARSE]: { height: 32, ...hitSlopAfter },
              }}
            >
              <IconAdd size={12} strokeWidth={ICON_STROKE} aria-hidden />
              <span>{s}</span>
            </ButtonBase>
          ))}
          {visibleSuggestions.length > 1 && free > 0 ? (
            <ButtonBase onClick={acceptAll} disabled={disabled} sx={{ fontSize: 12, fontWeight: 500, color: accent[600], px: '4px', borderRadius: '4px', ...hitSlopSx, ...focusVisibleSx, '&:hover': { textDecoration: 'underline' } }}>
              {t('addAll')}
            </ButtonBase>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

export default TagInput;
