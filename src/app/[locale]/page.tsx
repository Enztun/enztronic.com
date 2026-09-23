import Image from 'next/image';
import { Fragment } from 'react';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, GitBranch } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ModuleRenderer, {
  type PageModule,
} from '@/components/modules/ModuleRenderer';
import { Link } from '@/i18n/navigation';
import { isSanityConfigured } from '@/sanity/lib/client';
import { sanityFetch } from '@/sanity/lib/fetch';
import { pageBySlugQuery, postsByLocaleQuery } from '@/sanity/lib/queries';
import { urlFor } from '@/sanity/lib/image';
import type { PostSummary } from '@/sanity/lib/types';
import { createCorePageMetadata } from '@/lib/seo';
import { serviceIcon } from '@/lib/service-icons';
import HeroSection from '@/components/sections/HeroSection';
import StatsBand from '@/components/sections/StatsBand';
import CaseStudySection from '@/components/sections/CaseStudySection';
import ServicesSection from '@/components/sections/ServicesSection';
import {
  NextStepSection,
  WorkflowSection,
} from '@/components/sections/ExperienceSections';

type ServiceItem = { title: string; description: string; features: string[] };
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
  return createCorePageMetadata((await params).locale, 'home');
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [t, tServices, tPortfolio, guide] = await Promise.all([
    getTranslations({ locale, namespace: 'home' }),
    getTranslations({ locale, namespace: 'services' }),
    getTranslations({ locale, namespace: 'portfolio' }),
    getTranslations({ locale, namespace: 'experience.guide' }),
  ]);
  let modules: PageModule[] = [];
  let recentPosts: PostSummary[] = [];
  if (isSanityConfigured) {
    const [page, posts] = await Promise.allSettled([
      sanityFetch<{ modules?: PageModule[] } | null>({
        query: pageBySlugQuery,
        params: { slug: 'home', language: locale },
      }),
      sanityFetch<PostSummary[]>({
        query: postsByLocaleQuery,
        params: { locale },
      }),
    ]);
    if (page.status === 'fulfilled') modules = page.value?.modules ?? [];
    if (posts.status === 'fulfilled') recentPosts = posts.value.slice(0, 2);
  }
  const hasModule = (type: string) =>
    modules.some((module) => module._type === `module.${type}`);
  const services = tServices.raw('items') as ServiceItem[];
  const projects = (tPortfolio.raw('projects') as Project[]).slice(0, 3);
  const firstCaseStudy = modules.findIndex(
    (module) => module._type === 'module.caseStudy',
  );
  const serviceOverview = !hasModule('servicesGrid') ? (
    <ServicesSection
      pageHeading={false}
      heading={t('hero.servicesHeading')}
      subheading={t('hero.servicesSubheading')}
      services={services.map((service, index) => ({
        ...service,
        icon: serviceIcon(index),
      }))}
    />
  ) : null;

  return (
    <>
      <Navbar />
      <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen bg-surface selection:bg-primary/10"
    >
      {!hasModule('hero') && (
        <HeroSection
          badge={t('badge')}
          headline={t('headline')}
          description={t('description')}
          ctaPrimary={{ text: t('ctaPrimary'), href: '/contact' }}
          ctaSecondary={{ text: t('ctaSecondary'), href: '/portfolio' }}
          highlight={{
            value: t('hero.revenueGrowth'),
            label: t('hero.revenueLabel'),
          }}
          imageAlt={t('hero.featuredAlt')}
        />
      )}

      {/* Preserve authored module order; introduce missing services before proof. */}
      {modules.map((module, index) => (
        <Fragment key={module._key}>
          {index === firstCaseStudy && serviceOverview}
          <ModuleRenderer module={module} pageHeading={false} />
        </Fragment>
      ))}
      {!hasModule('stats') && (
        <StatsBand
          items={(
            ['years', 'projects', 'industries', 'retention'] as const
          ).map((key) => ({
            value: t(`stats.${key}`),
            label: t(`stats.${key}Label`),
          }))}
        />
      )}
      {firstCaseStudy === -1 && serviceOverview}
      {!hasModule('caseStudy') && (
        <CaseStudySection
          label={t('caseStudy.label')}
          title={t('caseStudy.title')}
          description={t('caseStudy.description')}
          features={[
            t('caseStudy.feature1'),
            t('caseStudy.feature2'),
            t('caseStudy.feature3'),
          ]}
          cta={{ text: t('caseStudy.cta'), href: 'https://qianlima.co.id' }}
          imageAlt={t('caseStudy.screenshot')}
        />
      )}

      {!hasModule('portfolioGrid') && (
        <section className="py-16 md:py-20 px-6 md:px-12 max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5 mb-10">
            <h2 className="text-3xl md:text-4xl">
              {t('hero.portfolioHeading')}
            </h2>
            <Link
              href="/portfolio"
              className="inline-flex items-center gap-2 text-brand font-semibold"
            >
              {t('hero.portfolioViewAll')}{' '}
              <ArrowRight aria-hidden="true" className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {projects.map((project) => (
              <Link
                key={project.url}
                href={
                  project.url.includes('qianlima.co.id')
                    ? '/portfolio/qianlima'
                    : '/portfolio'
                }
                className="group rounded-2xl border border-line bg-surface-muted p-6 hover:border-brand/40 transition-colors"
              >
                <span className="text-sm font-bold uppercase tracking-wider text-brand mb-3 block">
                  {project.category}
                </span>
                <h3 className="text-xl mb-3 group-hover:text-brand transition-colors">
                  {project.title}
                </h3>
                <p className="text-base text-on-surface-variant leading-relaxed mb-5">
                  {project.description}
                </p>
                <div className="flex flex-wrap gap-2">
                  {project.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs px-3 py-1 rounded-full bg-card border border-line text-on-surface-variant"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <ArrowRight
                  aria-hidden="true"
                  className="mt-6 h-5 w-5 text-brand"
                />
              </Link>
            ))}
          </div>
        </section>
      )}

      <WorkflowSection />

      <section className="py-16 md:py-20 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5 mb-10">
          <h2 className="text-3xl md:text-4xl">{t('hero.blogHeading')}</h2>
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-brand font-semibold"
          >
            {t('hero.blogViewAll')}{' '}
            <ArrowRight aria-hidden="true" className="w-4 h-4" />
          </Link>
        </div>
        <div
          className={`grid gap-6 ${recentPosts.length > 1 ? 'md:grid-cols-3' : recentPosts.length === 1 ? 'md:grid-cols-2' : 'max-w-3xl'}`}
        >
          <Link
            href="/guides/workflow-audit"
            className="group flex flex-col rounded-2xl border border-line bg-surface-muted p-6 md:p-8 hover:border-brand/40 transition-colors"
          >
            <GitBranch aria-hidden="true" className="h-8 w-8 mb-6 text-brand" />
            <span className="text-sm font-semibold uppercase tracking-wider text-brand mb-3">
              {guide('label')}
            </span>
            <h3 className="text-2xl mb-4 group-hover:text-brand">
              {guide('title')}
            </h3>
            <p className="text-on-surface-variant leading-relaxed mb-6">
              {guide('description')}
            </p>
            <span className="mt-auto inline-flex gap-2 items-center font-semibold text-brand">
              {guide('read')}{' '}
              <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
            </span>
          </Link>
          {recentPosts.map((post) => (
            <Link
              key={post._id}
              href={`/blog/${post.slug}`}
              className="group rounded-2xl border border-line overflow-hidden hover:border-brand/40 transition-colors"
            >
              {post.mainImage && (
                <div className="aspect-[16/9] overflow-hidden bg-surface-muted">
                  <Image
                    src={urlFor(post.mainImage)
                      .width(720)
                      .height(405)
                      .fit('crop')
                      .url()}
                    width={720}
                    height={405}
                    sizes="(min-width: 768px) 40vw, 90vw"
                    alt={post.mainImage.alt ?? post.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="p-6">
                {post.categories?.[0] && (
                  <span className="text-sm font-bold uppercase tracking-wider text-brand mb-3 block">
                    {post.categories[0].title}
                  </span>
                )}
                <h3 className="text-xl leading-snug mb-3 group-hover:text-brand">
                  {post.title}
                </h3>
                {post.excerpt && (
                  <p className="text-base leading-relaxed text-on-surface-variant mb-4">
                    {post.excerpt}
                  </p>
                )}
                {post.publishedAt && (
                  <p className="text-sm text-on-surface-variant">
                    {new Date(post.publishedAt).toLocaleDateString(
                      locale === 'zh'
                        ? 'zh-Hans-CN'
                        : locale === 'id'
                          ? 'id-ID'
                          : 'en-US',
                      { month: 'short', day: 'numeric', year: 'numeric' },
                    )}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      </section>
      <NextStepSection />
      </main>
      <Footer />
    </>
  );
}
