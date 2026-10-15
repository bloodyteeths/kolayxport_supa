// Shared DS types used by the data-display primitives (DESIGN_SYSTEM §4 "Shared types").
// If another M1 group publishes the same types from a shared module, the integrator re-points
// these exports there; the shapes are identical to DS §4 so consumers do not change.
import type { ReactNode } from 'react';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'attention' | 'neutral';
export type MarketplaceKey = 'etsy' | 'ebay' | 'amazon' | 'shopify' | 'wix' | 'trendyol' | 'hepsiburada' | 'n11';
export type CarrierKey = 'fedex' | 'ups' | 'dhl' | 'shippo';
export type BrandKey = MarketplaceKey | CarrierKey | 'veeqo' | 'parasut' | 'google' | 'chrome';

export type { ActionSpec } from '../types/actions';

/** Common props every DS component forwards (DS §4). */
export type DsBaseProps = {
  className?: string;
  'data-testid'?: string;
};

export type Slot = ReactNode;
