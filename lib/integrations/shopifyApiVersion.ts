/**
 * The one Shopify Admin API version used by every Shopify call in the app
 * (GraphQL Admin API only — App Store requirement 2.2.4). Keep `api_version`
 * under [webhooks] in shopify.app.toml on the same value.
 */
export const SHOPIFY_API_VERSION = '2026-07';

/** Admin GraphQL endpoint of a shop (`mystore.myshopify.com`). */
export function shopifyGraphqlUrl(shopDomain: string): string {
  return `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
}
