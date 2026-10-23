// lib/billing/editorTierServer.ts — server side of lib/billing/editorTier.ts: the account's editor tier, from the
// same entitlement the UI uses (lib/billing/requireFeature.accountEntitlement).
import { accountEntitlement } from './requireFeature';
import { editorTierForPlan, type EditorTier } from './editorTier';

export async function accountEditorTier(userId: string): Promise<EditorTier> {
  const acc = await accountEntitlement(userId);
  return editorTierForPlan(acc?.ent.plan);
}
