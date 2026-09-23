import { getTranslations } from 'next-intl/server';
import AboutIntroSection from '@/components/sections/AboutIntroSection';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ModuleRenderer from '@/components/modules/ModuleRenderer';
import { isSanityConfigured } from '@/sanity/lib/client';
import { sanityFetch } from '@/sanity/lib/fetch';
import { pageBySlugQuery } from '@/sanity/lib/queries';
import { createCorePageMetadata } from '@/lib/seo';
import {
  NextStepSection,
  ProcessSection,
} from '@/components/sections/ExperienceSections';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return createCorePageMetadata(locale, 'about');
}

export default async function About({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  let cmsPage;

  if (isSanityConfigured) {
    try {
      cmsPage = await sanityFetch({
        query: pageBySlugQuery,
        params: { slug: 'about', language: locale },
      });
    } catch {}
  }

  if (cmsPage?.modules?.length > 0) {
    return (
      <>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-surface">
        {cmsPage.modules.map((mod: { _type: string; _key: string }) => (
          <ModuleRenderer key={mod._key} module={mod} />
        ))}
        <ProcessSection />
        <NextStepSection />
        </main>
      <Footer />
    </>
    );
  }

  // Fallback
  const t = await getTranslations({ locale, namespace: 'about' });
  return (
    <>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-surface">
      <AboutIntroSection
        heading={t('heading')}
        paragraphs={[t('p1'), t('p2')]}
        stats={(['years', 'projects', 'industries', 'retention'] as const).map(
          (key) => ({
            value: t(`stats.${key}`),
            label: t(`stats.${key}Label`),
          }),
        )}
        founder={{ name: t('founder.name'), role: t('founder.title') }}
      />
      <ProcessSection />
      <NextStepSection />
      </main>
      <Footer />
    </>
  );
}
