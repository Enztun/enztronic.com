import Image from 'next/image';

/**
 * The approved Enztronic logo.
 *
 * Two variants exist and they are not interchangeable: the primary sits on
 * light surfaces, the inverse on dark ones. Geometry is identical between them
 * -- only the navy elements invert to white -- so callers must never recolour,
 * rotate, or stretch the asset. Choosing by `surface` here keeps that decision
 * in one place instead of at every call site.
 *
 * The assets are transparent WebP, so a variant no longer has to sit on a
 * surface matching its own background -- only one light enough or dark enough
 * to hold it. That is still the caller's choice, which is why `surface` exists.
 */
export type BrandSurface = 'light' | 'dark';

const ASSETS = {
  mark: {
    light: { src: '/brand/enztronic-mark-primary.webp', width: 1200, height: 1200 },
    dark: { src: '/brand/enztronic-mark-inverse.webp', width: 1200, height: 1200 },
  },
  lockup: {
    light: { src: '/brand/enztronic-lockup-primary.webp', width: 2079, height: 756 },
    dark: { src: '/brand/enztronic-lockup-inverse.webp', width: 2079, height: 756 },
  },
} as const;

interface BrandLogoProps {
  /** `lockup` includes the wordmark; `mark` is the icon alone. */
  variant?: 'mark' | 'lockup';
  /**
   * Pin the variant to a fixed surface. Omit it on surfaces that follow the
   * page theme, and both variants are rendered with CSS revealing the correct
   * one -- no client round-trip, no hydration mismatch.
   */
  surface?: BrandSurface;
  /** Rendered height in pixels. Width follows the asset's aspect ratio. */
  height?: number;
  className?: string;
  priority?: boolean;
}

function LogoImage({
  asset,
  height,
  className,
  priority,
}: {
  asset: { src: string; width: number; height: number };
  height: number;
  className: string;
  priority: boolean;
}) {
  // Derived from the asset's own dimensions so the logo can never be stretched.
  const width = Math.round((asset.width / asset.height) * height);
  return (
    <Image
      src={asset.src}
      alt="ENZTRONIC"
      width={width}
      height={height}
      priority={priority}
      className={className}
      style={{ height, width: 'auto' }}
    />
  );
}

export function BrandLogo({
  variant = 'mark',
  surface,
  height = 40,
  className = '',
  priority = false,
}: BrandLogoProps) {
  if (surface) {
    return (
      <LogoImage
        asset={ASSETS[variant][surface]}
        height={height}
        className={className}
        priority={priority}
      />
    );
  }

  return (
    <>
      <LogoImage
        asset={ASSETS[variant].light}
        height={height}
        className={`brand-logo-light ${className}`}
        priority={priority}
      />
      <LogoImage
        asset={ASSETS[variant].dark}
        height={height}
        className={`brand-logo-dark ${className}`}
        priority={priority}
      />
    </>
  );
}
