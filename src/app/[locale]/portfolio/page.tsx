import { getTranslations } from 'next-intl/server';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ModuleRenderer from '@/components/modules/ModuleRenderer';
import ProjectRow from '@/components/portfolio/ProjectRow';
import { isSanityConfigured } from '@/sanity/lib/client';
import { sanityFetch } from '@/sanity/lib/fetch';
import { pageBySlugQuery } from '@/sanity/lib/queries';
import { createCorePageMetadata } from '@/lib/seo';
import { NextStepSection } from '@/components/sections/ExperienceSections';

type Project = {
  title: string;
  category: string;
  description: string;
  url: string;
  tags: string[];
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return createCorePageMetadata(locale, 'portfolio');
}

export default async function Portfolio({
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
        params: { slug: 'portfolio', language: locale },
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
        <NextStepSection />
        </main>
      <Footer />
    </>
    );
  }

  // Fallback
  const t = await getTranslations({ locale, namespace: 'portfolio' });
  const projects = t.raw('projects') as Project[];
  return (
    <>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-surface">
      <section className="pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-6xl font-bold mb-6">
            {t('heading')}
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            {t('description')}
          </p>
        </div>
        <div className="mt-4">
          {projects.map((project, index) => (
            <ProjectRow
              key={project.url}
              project={project}
              index={index}
              total={projects.length}
              visitLabel={t('visitSite')}
            />
          ))}
        </div>
      </section>
      <NextStepSection />
      </main>
      <Footer />
    </>
  );
}
