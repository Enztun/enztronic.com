import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, CheckCircle, BarChart, Code, Megaphone, Target, Palette, TrendingUp, Users, MessageCircle } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ModuleRenderer from '@/components/modules/ModuleRenderer';
import { Link } from '@/i18n/navigation';
import { client, isSanityConfigured } from '@/sanity/lib/client';
import { pageBySlugQuery, postsByLocaleQuery } from '@/sanity/lib/queries';
import { urlFor } from '@/sanity/lib/image';
import type { PostSummary } from '@/sanity/lib/types';

const BASE = 'https://enztronic.com';
const WHATSAPP = 'https://wa.me/6289637579728';

const serviceIcons = [Code, Megaphone, Target, Palette, TrendingUp, Users];

type ServiceItem = { title: string; description: string; features: string[] };
type Project = { title: string; category: string; description: string; url: string; tags: string[] };

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
      languages: { en: BASE, id: `${BASE}/id`, 'zh-Hans': `${BASE}/zh`, 'x-default': BASE },
    },
    openGraph: { title: t('title'), description: t('description'), url: canonical },
  };
}

function formatDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(
    locale === 'zh' ? 'zh-Hans-CN' : locale === 'id' ? 'id-ID' : 'en-US',
    { month: 'short', day: 'numeric', year: 'numeric' }
  );
}

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  if (isSanityConfigured) {
    try {
      const page = await client.fetch(pageBySlugQuery, { slug: 'home', language: locale });
      if (page?.modules?.length > 0) {
        return (
          <main className="min-h-screen bg-surface selection:bg-primary/10">
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

  // ── Fallback ──────────────────────────────────────────────────────────────
  const t = await getTranslations({ locale, namespace: 'home' });
  const tServices = await getTranslations({ locale, namespace: 'services' });
  const tPortfolio = await getTranslations({ locale, namespace: 'portfolio' });

  const services = tServices.raw('items') as ServiceItem[];
  const projects = (tPortfolio.raw('projects') as Project[]).slice(0, 3);

  let recentPosts: PostSummary[] = [];
  if (isSanityConfigured) {
    try {
      recentPosts = await client.fetch(postsByLocaleQuery, { locale });
      if (recentPosts.length === 0 && locale !== 'en') {
        recentPosts = await client.fetch(postsByLocaleQuery, { locale: 'en' });
      }
      recentPosts = recentPosts.slice(0, 3);
    } catch {}
  }

  return (
    <main className="min-h-screen bg-surface selection:bg-primary/10">
      <Navbar />

      {/* ── Hero ── */}
      <section className="pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <span className="inline-block px-3 py-1 bg-primary/5 text-primary text-sm font-bold rounded-full mb-6">
              {t('badge')}
            </span>
            <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6">
              {t('headline').split('. ').slice(0, 2).join('. ')}.{' '}
              <span className="text-primary">{t('headline').split('. ').at(-1)}</span>
            </h1>
            <p className="text-lg text-gray-600 mb-10 max-w-lg">{t('description')}</p>
            <div className="flex gap-4 flex-wrap">
              <Link
                href="/contact"
                className="bg-primary text-white px-8 py-4 rounded-full font-bold hover:bg-blue-700 transition-colors"
              >
                {t('ctaPrimary')}
              </Link>
              <Link
                href="/portfolio"
                className="border border-gray-300 text-gray-800 px-8 py-4 rounded-full font-bold hover:bg-gray-50 transition-colors"
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
              <p className="text-3xl font-bold text-primary">{t('hero.revenueGrowth')}</p>
              <p className="text-sm text-gray-500">{t('hero.revenueLabel')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <section className="py-16 bg-gray-50 border-y border-gray-200">
        <div className="px-6 md:px-12 max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {(['years', 'projects', 'industries', 'retention'] as const).map((key) => (
            <div key={key}>
              <p className="text-3xl md:text-4xl font-bold">{t(`stats.${key}`)}</p>
              <p className="text-sm text-gray-500 uppercase tracking-wider mt-2">
                {t(`stats.${key}Label`)}
              </p>
            </div>
          ))}
        </div>
      </section>

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

      {/* ── Case study ── */}
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
            <h2 className="text-3xl md:text-4xl font-bold mb-6">{t('caseStudy.title')}</h2>
            <p className="text-base text-gray-600 mb-8 leading-relaxed">
              {t('caseStudy.description')}
            </p>
            <ul className="space-y-4 mb-10">
              {(['feature1', 'feature2', 'feature3'] as const).map((f) => (
                <li key={f} className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-primary shrink-0" />
                  <span>{t(`caseStudy.${f}`)}</span>
                </li>
              ))}
            </ul>
            <a
              href="https://qianlima.co.id"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-primary font-bold group w-fit"
            >
              {t('caseStudy.cta')}{' '}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
          </div>
        </div>
      </section>

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
                    className="text-xs px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-500"
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
        <div className="bg-gray-900 rounded-3xl px-8 md:px-16 py-16 text-center">
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
              className="inline-flex items-center gap-2 bg-white text-gray-900 font-semibold px-7 py-4 rounded-full hover:bg-gray-100 transition-colors"
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
