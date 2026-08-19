import { getTranslations } from 'next-intl/server';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ModuleRenderer from '@/components/modules/ModuleRenderer';
import { isSanityConfigured } from '@/sanity/lib/client';
import { sanityFetch } from '@/sanity/lib/fetch';
import { pageBySlugQuery } from '@/sanity/lib/queries';
import { createCorePageMetadata } from '@/lib/seo';
import ServicesSection from '@/components/sections/ServicesSection';
import { serviceIcon } from '@/lib/service-icons';

type ServiceItem = { title: string; description: string; features: string[] };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return createCorePageMetadata(locale, 'services');
}

export default async function Services({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  let cmsPage;

  if (isSanityConfigured) {
    try {
      cmsPage = await sanityFetch({
        query: pageBySlugQuery,
        params: { slug: 'services', language: locale },
      });
    } catch {}
  }

  if (cmsPage?.modules?.length > 0) {
    return (
      <main className="min-h-screen bg-surface">
        <Navbar />
        {cmsPage.modules.map((mod: { _type: string; _key: string }) => (
          <ModuleRenderer key={mod._key} module={mod} />
        ))}
        <Footer />
      </main>
    );
  }

  // Fallback
  const t = await getTranslations({ locale, namespace: 'services' });
  const items = t.raw('items') as ServiceItem[];
  return (
    <main className="min-h-screen bg-surface">
      <Navbar />
      <ServicesSection
        heading={t('heading')}
        subheading={t('subheading')}
        services={items.map((service, index) => ({ ...service, icon: serviceIcon(index) }))}
      />
      <Footer />
    </main>
  );
}
