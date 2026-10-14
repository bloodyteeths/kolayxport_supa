/**
 * Stock adapter registry (W2).
 */
import type { StockChannel } from '../types';
import type { StockAdapter } from './types';
import { etsyAdapter } from './etsy';
import { trendyolAdapter } from './trendyol';
import { shopifyAdapter } from './shopify';
import { ebayAdapter } from './ebay';
import { wixAdapter } from './wix';
import { amazonAdapter } from './amazon';
import { hepsiburadaAdapter } from './hepsiburada';

export const STOCK_ADAPTERS: Record<StockChannel, StockAdapter> = {
  etsy: etsyAdapter,
  trendyol: trendyolAdapter,
  shopify: shopifyAdapter,
  ebay: ebayAdapter,
  wix: wixAdapter,
  amazon: amazonAdapter,
  hepsiburada: hepsiburadaAdapter,
};

export function getAdapter(channel: string): StockAdapter | null {
  return (STOCK_ADAPTERS as Record<string, StockAdapter>)[channel] ?? null;
}

/**
 * Typical delay before a sale on this channel reaches us (shown in the wizard
 * as the "oversell window"). Etsy is event-driven; the others are polled.
 */
export const OVERSELL_WINDOW_MINUTES: Record<StockChannel, number> = {
  etsy: 1,
  trendyol: 3,
  shopify: 15,
  ebay: 15,
  wix: 15,
  amazon: 15,
  hepsiburada: 15,
};
