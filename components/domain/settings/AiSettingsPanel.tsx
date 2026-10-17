// components/domain/settings/AiSettingsPanel.tsx — Settings → AI: the seller's standing instructions for every AI
// feature (titles, tags, descriptions, alt text, replies, item specifics, attributes). Saved per marketplace with an
// "All marketplaces" default; lib/ai adds them to every prompt (marketplace rules still win).
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { SegmentedControl, TextField, TextArea, TagInput } from '@/components/ds/inputs';
import { Section, StickyActionBar } from '@/components/ds/page';
import { ErrorState, PanelSkeleton } from '@/components/ds/state';
import { useToast } from '@/components/ds/feedback';
import { neutral as n } from '@/lib/ds/tokens';
import { AI_PREF_MARKETPLACES, preferencesBlock, type AiMarketplaceKey, type AiPreferenceValue } from '@/lib/ai/preferences';
import { PanelHeading, SettingsRow } from './sender';

const KEY = '/api/ai/preferences';
const EMPTY: Required<Omit<AiPreferenceValue, 'tone' | 'brand' | 'notes'>> & { tone: string; brand: string; notes: string } = { tone: '', include: [], avoid: [], brand: '', notes: '' };
type Draft = typeof EMPTY;

const fetcher = async (url: string) => {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<{ preferences: Partial<Record<AiMarketplaceKey, AiPreferenceValue>> }>;
};

const toDraft = (p?: AiPreferenceValue | null): Draft => ({ tone: p?.tone || '', include: p?.include || [], avoid: p?.avoid || [], brand: p?.brand || '', notes: p?.notes || '' });
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

export function AiSettingsPanel({ heading = true }: { heading?: boolean }) {
  const t = useTranslations('settings.ai');
  const toast = useToast();
  const { data, error, isLoading, mutate } = useSWR(KEY, fetcher, { revalidateOnFocus: false });
  const [mp, setMp] = useState<AiMarketplaceKey>('all');
  const saved = useMemo(() => toDraft(data?.preferences?.[mp]), [data, mp]);
  const [draft, setDraft] = useState<Draft>(saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(saved), [saved]);
  const dirty = !same(draft, saved);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(KEY, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marketplace: mp, ...draft }) });
      if (!r.ok) throw new Error(String(r.status));
      await mutate();
      toast.success(t('saved'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const preview = preferencesBlock({ ...draft, tone: draft.tone || null, brand: draft.brand || null, notes: draft.notes || null });

  return (
    <div data-testid="ai-settings-panel">
      {heading ? <PanelHeading title={t('title')} description={t('description')} /> : null}
      {error ? (
        <ErrorState variant="inline" title={t('loadFailed')} onRetry={() => { void mutate(); }} />
      ) : isLoading && !data ? (
        <PanelSkeleton sections={2} />
      ) : (
        <>
          <Section variant="card" id="ai-preferences">
            <SettingsRow label={t('appliesTo')} helper={t('appliesToHelp')}>
              {() => (
                <SegmentedControl<AiMarketplaceKey>
                  aria-label={t('appliesTo')}
                  value={mp}
                  onChange={(v) => { if (!dirty || window.confirm(t('discardConfirm'))) setMp(v); }}
                  options={AI_PREF_MARKETPLACES.map((m) => ({ value: m, label: t(`mp.${m}`) }))}
                  size="sm"
                />
              )}
            </SettingsRow>
            <SettingsRow label={t('tone')} helper={t('toneHelp')}>
              {(id) => <TextField id={id} value={draft.tone} onChange={(v) => setDraft((d) => ({ ...d, tone: v.slice(0, 80) }))} placeholder={t('tonePlaceholder')} />}
            </SettingsRow>
            <SettingsRow label={t('include')} helper={t('includeHelp')}>
              {() => <TagInput value={draft.include} onChange={(v) => setDraft((d) => ({ ...d, include: v.slice(0, 25) }))} maxLength={40} max={25} aria-label={t('include')} />}
            </SettingsRow>
            <SettingsRow label={t('avoid')} helper={t('avoidHelp')}>
              {() => <TagInput value={draft.avoid} onChange={(v) => setDraft((d) => ({ ...d, avoid: v.slice(0, 25) }))} maxLength={40} max={25} aria-label={t('avoid')} />}
            </SettingsRow>
            <SettingsRow label={t('brand')} helper={t('brandHelp')}>
              {(id) => <TextField id={id} value={draft.brand} onChange={(v) => setDraft((d) => ({ ...d, brand: v.slice(0, 80) }))} />}
            </SettingsRow>
            <SettingsRow label={t('notes')} helper={t('notesHelp')}>
              {(id) => <TextArea id={id} value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v.slice(0, 1000) }))} minRows={3} maxRows={8} placeholder={t('notesPlaceholder')} />}
            </SettingsRow>
          </Section>
          {preview ? (
            <Box sx={{ mt: '12px', p: '12px', borderRadius: '8px', bgcolor: n[50], border: `1px solid ${n[200]}` }} data-testid="ai-preferences-preview">
              <Box sx={{ fontSize: 12, fontWeight: 600, color: n[600], mb: '6px' }}>{t('previewTitle')}</Box>
              <Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, lineHeight: '20px', color: n[800] }}>{preview}</Box>
            </Box>
          ) : null}
        </>
      )}
      <StickyActionBar
        visible={dirty}
        ariaLabel={t('title')}
        status={t('unsaved')}
        secondary={{ id: 'ai-prefs-discard', label: t('discard'), onClick: () => setDraft(saved), disabled: saving }}
        primary={{ id: 'ai-prefs-save', label: t('save'), onClick: () => { void save(); }, loading: saving, loadingLabel: t('saving') }}
      />
    </div>
  );
}

export default AiSettingsPanel;
