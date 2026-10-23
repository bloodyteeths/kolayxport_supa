// components/domain/listings/editor/EditorUpgrade.tsx — "upgrade to unlock" for the Etsy bulk editor tiers
// (lib/billing/editorTier.ts). requestEditorUpgrade(reason) opens the dialog from anywhere; one <EditorUpgradeHost/>
// per page renders it. It says which plan unlocks the capability and lists what that plan adds.
import React from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay';
import { CHOOSE_PLAN_HREF, isNeutralBilling } from '@/lib/billing/billingState';
import { useEntitlement } from '@/lib/billing/useEntitlement';
import { EDITOR_LIMITS, tierFor, type EditorCapability, type EditorTier } from '@/lib/billing/editorTier';
import { useEditorTier } from '@/lib/billing/useEditorTier';

export type EditorUpgradeReason = EditorCapability | 'sendSize';
const EVENT = 'kx:editor-upgrade';

export function requestEditorUpgrade(reason: EditorUpgradeReason, detail: { count?: number } = {}): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: { reason, ...detail } }));
}

/** Pure: what the next tier adds over the current one (capability keys, plus the send cap change). */
export function tierAdds(from: EditorTier, to: EditorTier): EditorUpgradeReason[] {
  const caps = (Object.keys(EDITOR_LIMITS[to].capabilities) as EditorCapability[]).filter((c) => EDITOR_LIMITS[to].capabilities[c] && !EDITOR_LIMITS[from].capabilities[c]);
  return [...caps, 'sendSize'];
}

export function EditorUpgradeHost() {
  const t = useTranslations('listings.editorTier');
  const { tier, maxPerSend } = useEditorTier();
  // Neutral billing (Shopify-installed, the Play app): no plan names, prices or plans link (App Store 1.2.1, Play).
  const { data: ent } = useEntitlement();
  const neutral = isNeutralBilling(ent);
  const [state, setState] = React.useState<{ reason: EditorUpgradeReason; count?: number } | null>(null);
  React.useEffect(() => {
    const on = (e: Event) => setState((e as CustomEvent).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  if (!state || !tier) return null;
  const target: EditorTier = state.reason === 'sendSize' ? (tier === 'basic' ? 'plus' : 'pro') : tierFor(state.reason);
  const adds = tierAdds(tier, target);
  const nextMax = EDITOR_LIMITS[target].maxPerSend;
  if (neutral) {
    return (
      <Modal
        open
        onClose={() => setState(null)}
        title={state.reason === 'sendSize' ? t('sendSizeTitle', { max: maxPerSend ?? 0, count: state.count ?? 0 }) : t('neutralTitle', { feature: t(`cap.${state.reason}`) })}
        primary={{ id: 'editor-upgrade-ok', label: t('ok'), onClick: () => setState(null) }}
        secondary={null}
        data-testid="editor-upgrade"
      />
    );
  }
  return (
    <Modal
      open
      onClose={() => setState(null)}
      title={state.reason === 'sendSize' ? t('sendSizeTitle', { max: maxPerSend ?? 0, count: state.count ?? 0 }) : t('lockedTitle', { feature: t(`cap.${state.reason}`) })}
      description={t('unlockedOn', { plan: t(`plan.${target}`) })}
      primary={{ id: 'editor-upgrade', label: t('seePlans'), href: CHOOSE_PLAN_HREF }}
      secondary={{ id: 'editor-upgrade-close', label: t('notNow'), onClick: () => setState(null) }}
      data-testid="editor-upgrade"
    >
      <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {adds.map((a) => (
          <li key={a}>{a === 'sendSize' ? (nextMax === null ? t('addsUnlimited') : t('addsMax', { max: nextMax })) : t(`cap.${a}`)}</li>
        ))}
      </ul>
    </Modal>
  );
}
