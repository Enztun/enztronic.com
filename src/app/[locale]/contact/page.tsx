import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ContactForm from '@/components/ContactForm';

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
      <section className="pt-32 pb-24 px-6 md:px-12 max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-sm uppercase tracking-[0.3em] text-primary font-bold">
            {t('label')}
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mt-5">{t('heading')}</h1>
          <p className="mt-6 text-gray-600 max-w-2xl mx-auto">{t('description')}</p>
        </div>

        <div className="rounded-3xl border border-gray-200 bg-gray-50 p-8 md:p-10 mb-8">
          <ContactForm />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-200">
            <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1">
              Email
            </p>
            <a href={`mailto:${t('email')}`} className="text-sm text-primary underline underline-offset-2">
              {t('email')}
            </a>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-200">
            <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1">
              {t('office')}
            </p>
            <p className="text-sm text-gray-700">{t('officeLocation')}</p>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-200">
            <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1">
              {t('phone')}
            </p>
            <a
              href={`https://wa.me/${t('phoneNumber').replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-700"
            >
              {t('phoneNumber')}
            </a>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
