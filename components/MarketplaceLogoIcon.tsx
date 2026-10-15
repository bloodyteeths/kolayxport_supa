import React from 'react';
import { getLogo, type LogoProvider } from '@/lib/ds/logos';

type LogoIconProps = {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  'aria-hidden'?: boolean | 'true' | 'false';
};

/**
 * Lucide-compatible icon component that renders a marketplace's real logo, so nav
 * configs that expect `icon: LucideIcon` can take a logo as a drop-in. The label
 * next to it names the marketplace, so the image itself is decorative (alt="").
 */
export function logoIcon(provider: LogoProvider) {
  const asset = getLogo(provider);
  function LogoIcon({ size = 18, className, style }: LogoIconProps) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={asset.src}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className={className}
        style={{ width: size, height: size, objectFit: 'contain', borderRadius: 4, flexShrink: 0, ...style, color: undefined }}
      />
    );
  }
  LogoIcon.displayName = `LogoIcon(${provider})`;
  return LogoIcon;
}

export const EtsyLogoIcon = logoIcon('etsy');
export const EbayLogoIcon = logoIcon('ebay');
export const TrendyolLogoIcon = logoIcon('trendyol');
export const WixLogoIcon = logoIcon('wix');
export const ShopifyLogoIcon = logoIcon('shopify');
export const AmazonLogoIcon = logoIcon('amazon');
