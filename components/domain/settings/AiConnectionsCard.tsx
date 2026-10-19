// components/domain/settings/AiConnectionsCard.tsx — Settings → AI → "Connect your own AI": the seller connects Claude,
// ChatGPT, Cursor or Claude Code to their shop over MCP (pages/api/mcp). Shows the server address and how to add it in
// each app (OAuth sign-in for Claude / ChatGPT; a personal key for apps that take a header), creates personal keys
// (shown once), and lists every connection with "Remove". Founder 2026-10-17: no in-app chat — the seller's own AI.
import { useState } from 'react';
import useSWR from 'swr';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Button, Checkbox, SegmentedControl, TextField } from '@/components/ds/inputs';
import { Section } from '@/components/ds/page';
import { useToast } from '@/components/ds/feedback';
import { useConfirm } from '@/components/ds/overlay/ConfirmDialog';
import { CopyText } from '@/components/ds/format/CopyText';
import { useFormatters } from '@/lib/format';
import { neutral as n, tone } from '@/lib/ds/tokens';

type Connection = { id: string; name: string; kind: 'oauth' | 'token'; scopes: string[]; tokenPrefix: string; createdAt: string; lastUsedAt: string | null; expiresAt: string | null };
const KEY = '/api/mcp/connections';
const fetcher = async (url: string) => {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<{ connections: Connection[] }>;
};

export function AiConnectionsCard() {
  const t = useTranslations('settings.aiConnect');
  const f = useFormatters();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, mutate } = useSWR(KEY, fetcher, { revalidateOnFocus: true });
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('write');
  // Buyer names + addresses (orders:buyer): off by default, only granted when ticked.
  const [shareBuyer, setShareBuyer] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const url = typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : 'https://kolayxport.com/api/mcp';

  const create = async () => {
    setCreating(true);
    try {
      const r = await fetch(KEY, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() || t('defaultName'), scopes: scope === 'write' ? ['read', 'write'] : ['read'], shareBuyer }) });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.token) throw new Error(d?.code || 'create');
      setCreated(d.token);
      setName('');
      setShareBuyer(false);
      await mutate();
    } catch {
      toast.error(t('createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (c: Connection) => {
    if (!(await confirm({ title: t('revokeTitle', { name: c.name }), body: t('revokeBody'), confirmLabel: t('revoke'), tone: 'danger' }))) return;
    const r = await fetch(`${KEY}?id=${encodeURIComponent(c.id)}`, { method: 'DELETE', credentials: 'same-origin' });
    if (r.ok) { toast.success(t('revoked')); await mutate(); } else toast.error(t('revokeFailed'));
  };

  const list = data?.connections ?? [];
  return (
    <Section variant="card" id="ai-connections" data-testid="ai-connections">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Box>
          <Box component="h3" sx={{ m: 0, fontSize: 16, fontWeight: 600, color: n[900] }}>{t('title')}</Box>
          <Box sx={{ fontSize: 13, color: n[600], mt: '4px', lineHeight: '19px' }}>{t('description')}</Box>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Box sx={{ fontSize: 12, fontWeight: 600, color: n[600] }}>{t('serverUrl')}</Box>
          <Box sx={{ p: '8px 10px', borderRadius: '8px', bgcolor: n[50], border: `1px solid ${n[200]}`, fontSize: 13, minWidth: 0 }}>
            <CopyText value={url} mono />
          </Box>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: '10px' }}>
          {(['claude', 'chatgpt'] as const).map((app) => (
            <Box key={app} sx={{ p: '10px 12px', borderRadius: '8px', border: `1px solid ${n[200]}` }}>
              <Box sx={{ fontSize: 13, fontWeight: 600, color: n[800], mb: '4px' }}>{t(`app.${app}.name`)}</Box>
              <Box component="ol" sx={{ m: 0, pl: '18px', fontSize: 12, lineHeight: '18px', color: n[700] }}>
                {(t.raw(`app.${app}.steps`) as string[]).map((s) => <li key={s}>{s}</li>)}
              </Box>
            </Box>
          ))}
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', p: '10px 12px', borderRadius: '8px', border: `1px solid ${n[200]}` }}>
          <Box sx={{ fontSize: 13, fontWeight: 600, color: n[800] }}>{t('key.title')}</Box>
          <Box sx={{ fontSize: 12, color: n[600], lineHeight: '18px' }}>{t('key.hint')}</Box>
          <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Box sx={{ flex: '1 1 180px', minWidth: 0 }}><TextField value={name} onChange={(v) => setName(v.slice(0, 80))} placeholder={t('key.namePlaceholder')} /></Box>
            <SegmentedControl<'read' | 'write'> aria-label={t('key.permission')} value={scope} onChange={setScope} options={[{ value: 'read', label: t('scope.read') }, { value: 'write', label: t('scope.write') }]} size="sm" />
            <Button variant="secondary" onClick={() => void create()} loading={creating}>{t('key.create')}</Button>
          </Box>
          <Checkbox checked={shareBuyer} onChange={setShareBuyer} label={t('key.shareBuyer')} description={t('key.shareBuyerHint')} data-testid="ai-connections-share-buyer" />
          {created ? (
            <Box sx={{ p: '10px', borderRadius: '8px', bgcolor: tone.warning.bg, border: `1px solid ${tone.warning.border}`, display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }} data-testid="ai-connections-new-key">
              <Box sx={{ fontSize: 12, fontWeight: 600, color: tone.warning.fg }}>{t('key.once')}</Box>
              <CopyText value={created} mono wrap />
              <Box sx={{ fontSize: 12, color: n[700] }}>{t('key.claudeCode')}</Box>
              <CopyText value={`claude mcp add --transport http kolayxport ${url} --header "Authorization: Bearer ${created}"`} mono wrap />
            </Box>
          ) : null}
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Box sx={{ fontSize: 12, fontWeight: 600, color: n[600] }}>{t('connected')}</Box>
          {!list.length ? <Box sx={{ fontSize: 13, color: n[500] }}>{t('none')}</Box> : null}
          {list.map((c) => (
            <Box key={c.id} sx={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', p: '8px 10px', borderRadius: '8px', border: `1px solid ${n[100]}` }}>
              <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
                <Box sx={{ fontSize: 13, fontWeight: 600, color: n[800], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</Box>
                <Box sx={{ fontSize: 12, color: n[500] }}>
                  {c.kind === 'oauth' ? t('kind.oauth') : t('kind.token', { prefix: c.tokenPrefix })} · {c.scopes.includes('write') ? t('scope.write') : t('scope.read')} · {c.scopes.includes('orders:buyer') ? t('buyer.on') : t('buyer.off')} · {c.lastUsedAt ? t('lastUsed', { date: f.relative(c.lastUsedAt) }) : t('neverUsed')}
                </Box>
              </Box>
              <Button variant="ghost" size="sm" onClick={() => void revoke(c)}>{t('revoke')}</Button>
            </Box>
          ))}
        </Box>
        <Box sx={{ fontSize: 12, color: n[500], lineHeight: '18px' }}>{t('privacy')}</Box>
      </Box>
    </Section>
  );
}

export default AiConnectionsCard;
