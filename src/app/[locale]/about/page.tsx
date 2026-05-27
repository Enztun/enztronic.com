import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const BASE = 'https://enztronic.com';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta.about' });
  const canonical = locale === 'en' ? `${BASE}/about` : `${BASE}/${locale}/about`;

  return {
    title: t('title'),
    description: t('description'),
    alternates: {
      canonical,
      languages: {
        en: `${BASE}/about`,
        id: `${BASE}/id/about`,
        'zh-Hans': `${BASE}/zh/about`,
        'x-default': `${BASE}/about`,
      },
    },
    openGraph: {
      title: t('title'),
      description: t('description'),
      url: canonical,
    },
  };
}

export default async function About({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'about' });

  return (
    <main className="min-h-screen bg-white">
      <Navbar />

      <section className="pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6">
              {t('heading')}
            </h1>
            <p className="text-lg text-gray-600 mb-6">{t('p1')}</p>
            <p className="text-lg text-gray-600 mb-8">{t('p2')}</p>

            <div className="grid grid-cols-2 gap-6 mt-12">
              <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                <p className="text-3xl font-bold text-primary mb-2">
                  {t('stats.years')}
                </p>
                <p className="text-gray-600">{t('stats.yearsLabel')}</p>
              </div>
              <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                <p className="text-3xl font-bold text-primary mb-2">
                  {t('stats.projects')}
                </p>
                <p className="text-gray-600">{t('stats.projectsLabel')}</p>
              </div>
              <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                <p className="text-3xl font-bold text-primary mb-2">
                  {t('stats.industries')}
                </p>
                <p className="text-gray-600">{t('stats.industriesLabel')}</p>
              </div>
              <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                <p className="text-3xl font-bold text-primary mb-2">
                  {t('stats.retention')}
                </p>
                <p className="text-gray-600">{t('stats.retentionLabel')}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-100 rounded-3xl p-12 flex items-center justify-center min-h-[500px]">
            <div className="text-center">
              <div className="w-64 h-64 bg-gray-300 rounded-full mx-auto mb-8 flex items-center justify-center">
                <span className="text-gray-500">{t('founder.portrait')}</span>
              </div>
              <h3 className="text-2xl font-bold mb-2">{t('founder.name')}</h3>
              <p className="text-gray-600">{t('founder.title')}</p>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
