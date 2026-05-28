import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Code, Megaphone, Target, Palette, TrendingUp, Users } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ModuleRenderer from '@/components/modules/ModuleRenderer';
import { isSanityConfigured } from '@/sanity/lib/client';
import { sanityFetch } from '@/sanity/lib/fetch';
import { pageBySlugQuery } from '@/sanity/lib/queries';

const BASE = 'https://enztronic.com';
const serviceIcons = [Code, Megaphone, Target, Palette, TrendingUp, Users];
type ServiceItem = { title: string; description: string; features: string[] };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta.services' });
  const canonical = locale === 'en' ? `${BASE}/services` : `${BASE}/${locale}/services`;
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical, languages: { en: `${BASE}/services`, id: `${BASE}/id/services`, 'zh-Hans': `${BASE}/zh/services`, 'x-default': `${BASE}/services` } },
    openGraph: { title: t('title'), description: t('description'), url: canonical },
  };
}

export default async function Services({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  if (isSanityConfigured) {
    try {
      const page = await sanityFetch({ query: pageBySlugQuery, params: { slug: 'services', language: locale } });
      if (page?.modules?.length > 0) {
        return (
          <main className="min-h-screen bg-white">
            <Navbar />
            {page.modules.map((mod: { _type: string; _key: string }) => (
              <ModuleRenderer key={mod._key} module={mod} />
            ))}
            <Footer />
          </main>
        );
      }
    } catch {}
  }

  // Fallback
  const t = await getTranslations({ locale, namespace: 'services' });
  const items = t.raw('items') as ServiceItem[];
  return (
    <main className="min-h-screen bg-white">
      <Navbar />
      <section className="pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-6xl font-bold mb-6">{t('heading')}</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">{t('subheading')}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {items.map((service, index) => {
            const Icon = serviceIcons[index];
            return (
              <div key={index} className="bg-gray-50 rounded-2xl p-8 border border-gray-200 hover:shadow-lg transition-shadow">
                <Icon className="w-12 h-12 text-primary mb-6" />
                <h3 className="text-2xl font-bold mb-4">{service.title}</h3>
                <p className="text-gray-600 mb-6">{service.description}</p>
                <ul className="space-y-2">
                  {service.features.map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                      <span className="w-2 h-2 bg-primary rounded-full" />{feature}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
      <Footer />
    </main>
  );
}
