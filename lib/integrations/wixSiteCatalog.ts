/**
 * Per-site Wix Stores catalog version (V1 / V3), cached on `WixSite.catalogVersion`.
 * Server-only (Prisma). See lib/integrations/wixCatalogV3.ts.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type { WixApiClient, WixCatalogOptions } from './wixClient';
import { normalizeCatalogVersion } from './wixCatalogV3';

/**
 * Client options for a connected site: the stored version, and a callback that
 * stores a version the client finds (versioning endpoint or a 501 from a V1 call).
 * Without a site row (legacy Credential-only setups) nothing is stored.
 */
export function wixCatalogOptionsForSite(site: { id: string; catalogVersion?: string | null } | null | undefined): WixCatalogOptions {
  if (!site) return {};
  return {
    catalogVersion: normalizeCatalogVersion(site.catalogVersion),
    onCatalogVersion: async (version) => {
      try {
        await prisma.wixSite.update({ where: { id: site.id }, data: { catalogVersion: version } });
        logger.info('[WIX] Catalog version stored', { wixSiteId: site.id, catalogVersion: version });
      } catch {
        /* best effort: detected again next time */
      }
    },
  };
}

/** Ask Wix for the catalog version once when the site has none stored (failures leave 501 detection on). */
export async function ensureWixCatalogVersion(client: WixApiClient): Promise<void> {
  if (typeof client?.getKnownCatalogVersion !== 'function' || client.getKnownCatalogVersion()) return;
  await client.resolveCatalogVersion();
}
