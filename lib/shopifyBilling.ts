import { logger } from './logger';

const API_VERSION = '2024-10';

interface ShopifyBillingPlan {
  name: string;
  amount: number;
  currencyCode: string;
  interval: 'EVERY_30_DAYS' | 'ANNUAL';
  trialDays?: number;
}

export const SHOPIFY_PLANS: Record<string, ShopifyBillingPlan> = {
  starter_month: {
    name: 'KolayXport Starter (Monthly)',
    amount: 9.99,
    currencyCode: 'USD',
    interval: 'EVERY_30_DAYS',
    trialDays: 30,
  },
  starter_year: {
    name: 'KolayXport Starter (Annual)',
    amount: 99.99,
    currencyCode: 'USD',
    interval: 'ANNUAL',
    trialDays: 30,
  },
  growth_month: {
    name: 'KolayXport Growth (Monthly)',
    amount: 24.99,
    currencyCode: 'USD',
    interval: 'EVERY_30_DAYS',
    trialDays: 30,
  },
  growth_year: {
    name: 'KolayXport Growth (Annual)',
    amount: 249.99,
    currencyCode: 'USD',
    interval: 'ANNUAL',
    trialDays: 30,
  },
};

export function shopifyPlanToInternal(planName: string): { plan: string; interval: string } {
  if (planName.includes('Growth')) {
    return { plan: 'growth', interval: planName.includes('Annual') ? 'year' : 'month' };
  }
  if (planName.includes('Starter')) {
    return { plan: 'starter', interval: planName.includes('Annual') ? 'year' : 'month' };
  }
  return { plan: 'starter', interval: 'month' };
}

async function shopifyGraphQL(shopDomain: string, accessToken: string, query: string, variables?: Record<string, any>) {
  const url = `https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Shopify GraphQL ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    logger.error('Shopify GraphQL errors', undefined, { errors: json.errors });
    throw new Error(`Shopify GraphQL error: ${json.errors[0].message}`);
  }
  return json.data;
}

export async function createShopifySubscription(
  shopDomain: string,
  accessToken: string,
  planKey: string,
  returnUrl: string,
  isTest = false,
): Promise<{ subscriptionId: string; confirmationUrl: string }> {
  const plan = SHOPIFY_PLANS[planKey];
  if (!plan) throw new Error(`Unknown plan: ${planKey}`);

  const mutation = `
    mutation AppSubscriptionCreate(
      $name: String!
      $lineItems: [AppSubscriptionLineItemInput!]!
      $returnUrl: URL!
      $test: Boolean
      $trialDays: Int
    ) {
      appSubscriptionCreate(
        name: $name
        lineItems: $lineItems
        returnUrl: $returnUrl
        test: $test
        trialDays: $trialDays
        replacementBehavior: APPLY_IMMEDIATELY
      ) {
        appSubscription {
          id
          status
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    name: plan.name,
    returnUrl,
    test: isTest,
    trialDays: plan.trialDays || 0,
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: { amount: plan.amount, currencyCode: plan.currencyCode },
            interval: plan.interval,
          },
        },
      },
    ],
  };

  const data = await shopifyGraphQL(shopDomain, accessToken, mutation, variables);
  const result = data.appSubscriptionCreate;

  if (result.userErrors?.length) {
    logger.error('Shopify billing userErrors', undefined, { errors: result.userErrors });
    throw new Error(`Shopify billing error: ${result.userErrors[0].message}`);
  }

  if (!result.confirmationUrl) {
    throw new Error('No confirmation URL returned from Shopify');
  }

  return {
    subscriptionId: result.appSubscription.id,
    confirmationUrl: result.confirmationUrl,
  };
}

export async function getActiveShopifySubscription(
  shopDomain: string,
  accessToken: string,
): Promise<{ id: string; name: string; status: string; trialDays: number; currentPeriodEnd: string | null } | null> {
  const query = `
    {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          trialDays
          currentPeriodEnd
          lineItems {
            plan {
              pricingDetails {
                ... on AppRecurringPricing {
                  price {
                    amount
                    currencyCode
                  }
                  interval
                }
              }
            }
          }
        }
      }
    }
  `;

  const data = await shopifyGraphQL(shopDomain, accessToken, query);
  const subs = data.currentAppInstallation?.activeSubscriptions || [];
  if (subs.length === 0) return null;

  const active = subs[0];
  return {
    id: active.id,
    name: active.name,
    status: active.status,
    trialDays: active.trialDays || 0,
    currentPeriodEnd: active.currentPeriodEnd || null,
  };
}

export async function cancelShopifySubscription(
  shopDomain: string,
  accessToken: string,
  subscriptionId: string,
): Promise<boolean> {
  const mutation = `
    mutation AppSubscriptionCancel($id: ID!) {
      appSubscriptionCancel(id: $id) {
        appSubscription {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyGraphQL(shopDomain, accessToken, mutation, { id: subscriptionId });
  const result = data.appSubscriptionCancel;

  if (result.userErrors?.length) {
    logger.error('Shopify cancel subscription error', undefined, { errors: result.userErrors });
    return false;
  }

  return true;
}
