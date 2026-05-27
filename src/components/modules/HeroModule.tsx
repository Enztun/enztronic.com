import { BarChart, ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';

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

export default function HeroModule({ data }: { data: HeroModuleData }) {
  return (
    <section className="pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div>
          {data.badge && (
            <span className="inline-block px-3 py-1 bg-primary/5 text-primary text-sm font-bold rounded-full mb-6">
              {data.badge}
            </span>
          )}
          <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6">
            {data.headline}{' '}
            {data.headlineHighlight && (
              <span className="text-primary">{data.headlineHighlight}</span>
            )}
          </h1>
          {data.description && (
            <p className="text-lg text-gray-600 mb-10 max-w-lg">{data.description}</p>
          )}
          <div className="flex gap-4 flex-wrap">
            {data.ctaPrimaryText && data.ctaPrimaryHref && (
              <Link
                href={data.ctaPrimaryHref as '/'}
                className="bg-primary text-white px-8 py-4 rounded-lg font-bold hover:shadow-lg transition-all"
              >
                {data.ctaPrimaryText}
              </Link>
            )}
            {data.ctaSecondaryText && data.ctaSecondaryHref && (
              <Link
                href={data.ctaSecondaryHref as '/'}
                className="border border-gray-300 text-gray-800 px-8 py-4 rounded-lg font-bold hover:bg-gray-50 transition-all"
              >
                {data.ctaSecondaryText}
              </Link>
            )}
          </div>
        </div>
        <div className="relative bg-gray-50 rounded-2xl p-8 border border-gray-200">
          <div className="aspect-video bg-white rounded-xl shadow-sm overflow-hidden flex items-center justify-center">
            <BarChart className="w-20 h-20 text-gray-300" />
          </div>
          {(data.revenueGrowth || data.revenueLabel) && (
            <div className="absolute -bottom-6 -left-6 bg-white p-6 rounded-xl shadow-xl border border-gray-200">
              {data.revenueGrowth && (
                <p className="text-3xl font-bold text-primary">{data.revenueGrowth}</p>
              )}
              {data.revenueLabel && (
                <p className="text-sm text-gray-500">{data.revenueLabel}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
