import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, CheckCircle, BarChart } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Link } from '@/i18n/navigation';

const BASE = 'https://enztronic.com';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta.home' });
  const canonical = locale === 'en' ? BASE : `${BASE}/${locale}`;

  return {
    title: t('title'),
    description: t('description'),
    alternates: {
      canonical,
      languages: {
        en: BASE,
        id: `${BASE}/id`,
        'zh-Hans': `${BASE}/zh`,
        'x-default': BASE,
      },
    },
    openGraph: {
      title: t('title'),
      description: t('description'),
      url: canonical,
    },
  };
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'home' });

  return (
    <main className="min-h-screen bg-surface selection:bg-primary/10">
      <Navbar />

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <span className="inline-block px-3 py-1 bg-primary/5 text-primary text-sm font-bold rounded-full mb-6">
              {t('badge')}
            </span>
            <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6">
              {t('headline').split('. ').slice(0, 2).join('. ')}.{' '}
              <span className="text-primary">
                {t('headline').split('. ').at(-1)}
              </span>
            </h1>
            <p className="text-lg text-gray-600 mb-10 max-w-lg">
              {t('description')}
            </p>
            <div className="flex gap-4 flex-wrap">
              <Link
                href="/contact"
                className="bg-primary text-white px-8 py-4 rounded-lg font-bold hover:shadow-lg transition-all"
              >
                {t('ctaPrimary')}
              </Link>
              <Link
                href="/portfolio"
                className="border border-gray-300 text-gray-800 px-8 py-4 rounded-lg font-bold hover:bg-gray-50 transition-all"
              >
                {t('ctaSecondary')}
              </Link>
            </div>
          </div>
          <div className="relative bg-gray-50 rounded-2xl p-8 border border-gray-200">
            <div className="aspect-video bg-white rounded-xl shadow-sm overflow-hidden flex items-center justify-center">
              <BarChart className="w-20 h-20 text-gray-300" />
            </div>
            <div className="absolute -bottom-6 -left-6 bg-white p-6 rounded-xl shadow-xl border border-gray-200">
              <p className="text-3xl font-bold text-primary">
                {t('hero.revenueGrowth')}
              </p>
              <p className="text-sm text-gray-500">{t('hero.revenueLabel')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Stats */}
      <section className="py-20 bg-gray-50 border-y border-gray-200">
        <div className="px-6 md:px-12 max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          <div>
            <p className="text-3xl md:text-4xl font-bold">{t('stats.years')}</p>
            <p className="text-sm text-gray-500 uppercase tracking-wider mt-2">
              {t('stats.yearsLabel')}
            </p>
          </div>
          <div>
            <p className="text-3xl md:text-4xl font-bold">
              {t('stats.projects')}
            </p>
            <p className="text-sm text-gray-500 uppercase tracking-wider mt-2">
              {t('stats.projectsLabel')}
            </p>
          </div>
          <div>
            <p className="text-3xl md:text-4xl font-bold">
              {t('stats.industries')}
            </p>
            <p className="text-sm text-gray-500 uppercase tracking-wider mt-2">
              {t('stats.industriesLabel')}
            </p>
          </div>
          <div>
            <p className="text-3xl md:text-4xl font-bold">
              {t('stats.retention')}
            </p>
            <p className="text-sm text-gray-500 uppercase tracking-wider mt-2">
              {t('stats.retentionLabel')}
            </p>
          </div>
        </div>
      </section>

      {/* Featured Project: Qianlima */}
      <section className="py-24 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="bg-gray-50 rounded-3xl overflow-hidden grid grid-cols-1 lg:grid-cols-2 border border-gray-200">
          <div className="bg-gray-200/50 flex items-center justify-center p-12">
            <div className="w-full h-[400px] bg-white/50 backdrop-blur-sm rounded-xl border border-white flex items-center justify-center text-gray-500 italic">
              {t('caseStudy.screenshot')}
            </div>
          </div>
          <div className="p-16 flex flex-col justify-center">
            <span className="text-primary font-bold tracking-widest text-sm mb-4 uppercase">
              {t('caseStudy.label')}
            </span>
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              {t('caseStudy.title')}
            </h2>
            <p className="text-base text-gray-600 mb-8 leading-relaxed">
              {t('caseStudy.description')}
            </p>
            <ul className="space-y-4 mb-10">
              <li className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-primary" />
                <span className="text-base">{t('caseStudy.feature1')}</span>
              </li>
              <li className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-primary" />
                <span className="text-base">{t('caseStudy.feature2')}</span>
              </li>
              <li className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-primary" />
                <span className="text-base">{t('caseStudy.feature3')}</span>
              </li>
            </ul>
            <a
              href="https://qianlima.co.id"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-primary font-bold group"
            >
              {t('caseStudy.cta')}{' '}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
