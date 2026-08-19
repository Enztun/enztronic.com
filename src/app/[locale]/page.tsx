import { getTranslations } from 'next-intl/server';
import { ArrowRight, Code, Megaphone, Target, Palette, TrendingUp, Users, MessageCircle } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ModuleRenderer from '@/components/modules/ModuleRenderer';
import { Link } from '@/i18n/navigation';
import { isSanityConfigured } from '@/sanity/lib/client';
import { sanityFetch } from '@/sanity/lib/fetch';
import { pageBySlugQuery, postsByLocaleQuery } from '@/sanity/lib/queries';
import { urlFor } from '@/sanity/lib/image';
import type { PostSummary } from '@/sanity/lib/types';
import { createCorePageMetadata } from '@/lib/seo';
import HeroSection from '@/components/sections/HeroSection';
import StatsBand from '@/components/sections/StatsBand';
import CaseStudySection from '@/components/sections/CaseStudySection';

const WHATSAPP = 'https://wa.me/6289637579728';

const serviceIcons = [Code, Megaphone, Target, Palette, TrendingUp, Users];

type ServiceItem = { title: string; description: string; features: string[] };
type Project = { title: string; category: string; description: string; url: string; tags: string[] };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return createCorePageMetadata(locale, 'home');
}

function formatDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(
    locale === 'zh' ? 'zh-Hans-CN' : locale === 'id' ? 'id-ID' : 'en-US',
    { month: 'short', day: 'numeric', year: 'numeric' }
  );
}

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  let cmsPage;

  if (isSanityConfigured) {
    try {
      cmsPage = await sanityFetch({
        query: pageBySlugQuery,
        params: { slug: 'home', language: locale },
      });
    } catch {}
  }

  if (cmsPage?.modules?.length > 0) {
    return (
      <main className="min-h-screen bg-surface selection:bg-primary/10">
        <Navbar />
        {cmsPage.modules.map((mod: { _type: string; _key: string }) => (
          <ModuleRenderer key={mod._key} module={mod} />
        ))}
        <Footer />
      </main>
    );
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  const t = await getTranslations({ locale, namespace: 'home' });
  const tServices = await getTranslations({ locale, namespace: 'services' });
  const tPortfolio = await getTranslations({ locale, namespace: 'portfolio' });

  const services = tServices.raw('items') as ServiceItem[];
  const projects = (tPortfolio.raw('projects') as Project[]).slice(0, 3);

  let recentPosts: PostSummary[] = [];
  if (isSanityConfigured) {
    try {
      recentPosts = await sanityFetch<PostSummary[]>({ query: postsByLocaleQuery, params: { locale } });
      recentPosts = recentPosts.slice(0, 3);
    } catch {}
  }

  return (
    <main className="min-h-screen bg-surface selection:bg-primary/10">
      <Navbar />

      <HeroSection
        badge={t('badge')}
        headline={t('headline')}
        description={t('description')}
        ctaPrimary={{ text: t('ctaPrimary'), href: '/contact' }}
        ctaSecondary={{ text: t('ctaSecondary'), href: '/portfolio' }}
        highlight={{ value: t('hero.revenueGrowth'), label: t('hero.revenueLabel') }}
        imageAlt={t('hero.featuredAlt')}
      />

      <StatsBand
        items={(['years', 'projects', 'industries', 'retention'] as const).map((key) => ({
          value: t(`stats.${key}`),
          label: t(`stats.${key}Label`),
        }))}
      />

      {/* ── Services overview ── */}
      <section className="py-24 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('hero.servicesHeading')}</h2>
          <p className="text-gray-500 max-w-xl mx-auto">{t('hero.servicesSubheading')}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map((svc, i) => {
            const Icon = serviceIcons[i] ?? Code;
            return (
              <div
                key={i}
                className="p-7 rounded-2xl border border-gray-200 hover:border-primary/30 hover:shadow-md transition-all"
              >
                <Icon className="w-8 h-8 text-primary mb-4" />
                <h3 className="font-bold text-lg mb-2">{svc.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{svc.description}</p>
              </div>
            );
          })}
        </div>
        <div className="text-center mt-10">
          <Link
            href="/services"
            className="inline-flex items-center gap-2 text-primary font-semibold hover:gap-3 transition-all"
          >
            {t('hero.servicesViewAll')} <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      <CaseStudySection
        label={t('caseStudy.label')}
        title={t('caseStudy.title')}
        description={t('caseStudy.description')}
        features={[t('caseStudy.feature1'), t('caseStudy.feature2'), t('caseStudy.feature3')]}
        cta={{ text: t('caseStudy.cta'), href: 'https://qianlima.co.id' }}
        imageAlt={t('caseStudy.screenshot')}
      />

      {/* ── Portfolio preview ── */}
      <section className="py-24 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="flex items-end justify-between mb-12">
          <h2 className="text-3xl md:text-4xl font-bold">{t('hero.portfolioHeading')}</h2>
          <Link
            href="/portfolio"
            className="hidden md:inline-flex items-center gap-2 text-primary font-semibold hover:gap-3 transition-all text-sm"
          >
            {t('hero.portfolioViewAll')} <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {projects.map((project, i) => (
            <a
              key={i}
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-2xl border border-gray-200 bg-gray-50 p-6 hover:shadow-lg hover:border-primary/30 transition-all"
            >
              <span className="text-xs font-bold uppercase tracking-widest text-primary mb-3 block">
                {project.category}
              </span>
              <h3 className="text-lg font-bold mb-2 group-hover:text-primary transition-colors">
                {project.title}
              </h3>
              <p className="text-sm text-gray-500 leading-relaxed line-clamp-3 mb-4">
                {project.description}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {project.tags.map((tag, j) => (
                  <span
                    key={j}
                    className="text-xs px-2 py-0.5 rounded-full bg-surface border border-gray-200 text-gray-500"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </a>
          ))}
        </div>
        <div className="text-center mt-8 md:hidden">
          <Link
            href="/portfolio"
            className="inline-flex items-center gap-2 text-primary font-semibold"
          >
            {t('hero.portfolioViewAll')} <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* ── Blog preview ── */}
      {recentPosts.length > 0 && (
        <section className="py-24 px-6 md:px-12 max-w-7xl mx-auto">
          <div className="flex items-end justify-between mb-12">
            <h2 className="text-3xl md:text-4xl font-bold">{t('hero.blogHeading')}</h2>
            <Link
              href="/blog"
              className="hidden md:inline-flex items-center gap-2 text-primary font-semibold hover:gap-3 transition-all text-sm"
            >
              {t('hero.blogViewAll')} <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {recentPosts.map((post) => (
              <Link
                key={post._id}
                href={`/blog/${post.slug}`}
                className="group rounded-2xl border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow"
              >
                {post.mainImage && (
                  <div className="aspect-[16/9] overflow-hidden bg-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={urlFor(post.mainImage).width(600).height(338).fit('crop').url()}
                      alt={(post.mainImage as { alt?: string }).alt ?? post.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                )}
                <div className="p-5">
                  {post.categories && post.categories.length > 0 && (
                    <span className="text-xs font-bold uppercase tracking-widest text-primary mb-2 block">
                      {post.categories[0].title}
                    </span>
                  )}
                  <h3 className="font-bold text-base leading-snug mb-2 group-hover:text-primary transition-colors">
                    {post.title}
                  </h3>
                  {post.publishedAt && (
                    <p className="text-xs text-gray-400">{formatDate(post.publishedAt, locale)}</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Bottom CTA ── */}
      <section className="py-24 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="brand-glow overflow-hidden bg-gray-900 dark:bg-navy-soft rounded-3xl px-8 md:px-16 py-16 text-center">
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6 max-w-2xl mx-auto leading-tight">
            {t('hero.ctaHeading')}
          </h2>
          <p className="text-white/60 text-lg mb-10 max-w-xl mx-auto">{t('hero.ctaBody')}</p>
          <div className="flex flex-wrap justify-center gap-4">
            <a
              href={WHATSAPP}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white font-semibold px-7 py-4 rounded-full transition-colors"
            >
              <MessageCircle className="w-5 h-5" />
              {t('hero.ctaWhatsapp')}
            </a>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 bg-white text-gray-900 dark:text-navy font-semibold px-7 py-4 rounded-full hover:bg-gray-100 dark:hover:bg-white/85 transition-colors"
            >
              {t('hero.ctaContact')}
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
