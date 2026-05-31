// scripts/auto-sync-all-users.js
//
// STUB — the real implementation is archived at scripts/archive/auto-sync-all-users.js.disabled.
// It references prisma.userIntegrationSettings (removed model — current model is Credential)
// and the legacy Veeqo/Shippo clients, so it cannot run as-is. The corresponding GitHub
// Actions workflow (.github/workflows/auto-sync-orders.yml) had its schedule removed in
// Sprint 2 and is workflow_dispatch-only.
//
// We keep these named exports so existing dynamic `require('../../../scripts/auto-sync-all-users.js')`
// statements in pages/api/orders/sync.ts and pages/api/sync/retry.ts compile. Each function
// throws a clear error if invoked at runtime, surfacing the fact that the real implementation
// is gone.

function notImplemented(name) {
  return async function (..._args) {
    throw new Error(
      `[${name}] scripts/auto-sync-all-users.js is archived (Sprint 5). ` +
        `Restore from scripts/archive/auto-sync-all-users.js.disabled and rewrite against ` +
        `the current Credential model + lib/sync/* helpers before re-enabling.`
    );
  };
}

const syncVeeqoRecentOrders = notImplemented('syncVeeqoRecentOrders');
const syncShippoRecentOrders = notImplemented('syncShippoRecentOrders');
const syncTrendyolRecentOrders = notImplemented('syncTrendyolRecentOrders');
const syncHepsiburadaRecentOrders = notImplemented('syncHepsiburadaRecentOrders');

module.exports = {
  syncVeeqoRecentOrders,
  syncShippoRecentOrders,
  syncTrendyolRecentOrders,
  syncHepsiburadaRecentOrders,
};
