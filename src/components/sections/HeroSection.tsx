import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { FEATURED_SCREENSHOT } from '@/lib/screenshots';
import type { Cta, Stat } from './types';

interface HeroSectionProps {
  badge?: string;
  headline?: string;
  headlineHighlight?: string;
  description?: string;
  ctaPrimary?: Cta;
  ctaSecondary?: Cta;
  /** The figure on the card floating over the screenshot. */
  highlight?: Stat;
  imageAlt: string;
}

/**
 * The page opener. Wrapped in `.brand-glow`, and the wrapper is full-bleed on
 * purpose: the section itself is `max-w-7xl`, so a wash applied to it would
 * stop dead at the content edge on a wide screen.
 */
export default function HeroSection({
  badge,
  headline,
  headlineHighlight,
  description,
  ctaPrimary,
  ctaSecondary,
  highlight,
  imageAlt,
}: HeroSectionProps) {
  return (
    <div className="brand-glow">
      <section className="pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            {badge && (
              <span className="inline-block px-3 py-1 bg-primary/5 text-primary text-sm font-bold rounded-full mb-6">
                {badge}
              </span>
            )}
            <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6">
              {headline}
              {headlineHighlight && (
                <>
                  {' '}
                  <span className="text-primary">{headlineHighlight}</span>
                </>
              )}
            </h1>
            {description && <p className="text-lg text-gray-600 mb-10 max-w-lg">{description}</p>}
            <div className="flex gap-4 flex-wrap">
              {ctaPrimary?.text && ctaPrimary.href && (
                <Link
                  href={ctaPrimary.href as '/'}
                  className="bg-brand-fill text-white px-8 py-4 rounded-full font-bold hover:bg-brand-fill-strong transition-colors"
                >
                  {ctaPrimary.text}
                </Link>
              )}
              {ctaSecondary?.text && ctaSecondary.href && (
                <Link
                  href={ctaSecondary.href as '/'}
                  className="border border-gray-300 text-gray-800 px-8 py-4 rounded-full font-bold hover:bg-gray-50 transition-colors"
                >
                  {ctaSecondary.text}
                </Link>
              )}
            </div>
          </div>
          <div className="relative bg-gray-50 rounded-2xl p-8 border border-gray-200">
            <div className="aspect-video bg-card rounded-xl shadow-sm overflow-hidden">
              <Image
                src={FEATURED_SCREENSHOT}
                alt={imageAlt}
                width={1440}
                height={900}
                priority
                sizes="(min-width: 1024px) 40vw, 90vw"
                className="h-full w-full object-cover object-top"
              />
            </div>
            {(highlight?.value || highlight?.label) && (
              <div className="absolute -bottom-6 -left-6 bg-card p-6 rounded-xl shadow-xl border border-gray-200">
                {highlight.value && (
                  <p className="text-3xl font-bold text-primary">{highlight.value}</p>
                )}
                {highlight.label && <p className="text-sm text-gray-500">{highlight.label}</p>}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
