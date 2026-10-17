-- Send-failure ICU params + the marketplace's own message (key `detail`), so a failed Trendyol/Wix/Shopify send keeps its exact reason after reload.
ALTER TABLE "CatalogDraft" ADD COLUMN "lastSyncErrorParams" JSONB;
