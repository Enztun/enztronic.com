import HeroSection from '@/components/sections/HeroSection';

type HeroModuleData = {
  badge?: string;
  headline?: string;
  headlineHighlight?: string;
  description?: string;
  ctaPrimaryText?: string;
  ctaPrimaryHref?: string;
  ctaSecondaryText?: string;
  ctaSecondaryHref?: string;
  revenueGrowth?: string;
  revenueLabel?: string;
};

/** Sanity's flat field names, mapped onto the shared section. */
export default function HeroModule({ data }: { data: HeroModuleData }) {
  return (
    <HeroSection
      badge={data.badge}
      headline={data.headline}
      headlineHighlight={data.headlineHighlight}
      description={data.description}
      ctaPrimary={{ text: data.ctaPrimaryText, href: data.ctaPrimaryHref }}
      ctaSecondary={{ text: data.ctaSecondaryText, href: data.ctaSecondaryHref }}
      highlight={{ value: data.revenueGrowth, label: data.revenueLabel }}
      imageAlt="A platform built by Enztronic"
    />
  );
}
