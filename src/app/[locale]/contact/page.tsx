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
  const t = await getTranslations({ locale, namespace: 'meta.contact' });
  const canonical =
    locale === 'en' ? `${BASE}/contact` : `${BASE}/${locale}/contact`;

  return {
    title: t('title'),
    description: t('description'),
    alternates: {
      canonical,
      languages: {
        en: `${BASE}/contact`,
        id: `${BASE}/id/contact`,
        'zh-Hans': `${BASE}/zh/contact`,
        'x-default': `${BASE}/contact`,
      },
    },
    openGraph: {
      title: t('title'),
      description: t('description'),
      url: canonical,
    },
  };
}

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'contact' });

  return (
    <main className="min-h-screen bg-white">
      <Navbar />
      <section className="pt-32 pb-24 px-6 md:px-12 max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-sm uppercase tracking-[0.3em] text-primary font-bold">
            {t('label')}
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mt-5">
            {t('heading')}
          </h1>
          <p className="mt-6 text-gray-600 max-w-2xl mx-auto">
            {t('description')}
          </p>
        </div>
        <div className="rounded-3xl border border-gray-200 bg-gray-50 p-10">
          <p className="text-gray-700 text-lg mb-6">
            {t('emailPromptPre')}{' '}
            <a
              href={`mailto:${t('email')}`}
              className="text-primary underline"
            >
              {t('email')}
            </a>{' '}
            {t('emailPromptPost')}
          </p>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-200">
              <p className="font-semibold mb-2">{t('office')}</p>
              <p className="text-gray-600">{t('officeLocation')}</p>
            </div>
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-200">
              <p className="font-semibold mb-2">{t('phone')}</p>
              <p className="text-gray-600">{t('phoneNumber')}</p>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
