// lib/billing/useEditorTier.ts — the account's Etsy bulk editor tier in the UI (lib/billing/editorTier.ts).
// While the entitlement is loading the tier is null and nothing is locked (the server still enforces).
import { useEntitlement } from './useEntitlement';
import { EDITOR_LIMITS, editorAllows, editorTierForPlan, sendWithinCap, type EditorCapability, type EditorTier } from './editorTier';

export interface EditorTierView {
  tier: EditorTier | null;
  maxPerSend: number | null;
  allows: (cap: EditorCapability) => boolean;
  withinCap: (count: number) => boolean;
}

export function useEditorTier(): EditorTierView {
  const { data } = useEntitlement();
  const tier = data ? editorTierForPlan(data.plan) : null;
  return {
    tier,
    maxPerSend: tier ? EDITOR_LIMITS[tier].maxPerSend : null,
    allows: (cap) => !tier || editorAllows(tier, cap),
    withinCap: (n) => !tier || sendWithinCap(tier, n),
  };
}
