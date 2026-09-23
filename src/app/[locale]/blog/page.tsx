import { getTranslations } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Link } from '@/i18n/navigation';
import { isSanityConfigured } from '@/sanity/lib/client';
import { sanityFetch } from '@/sanity/lib/fetch';
import { urlFor } from '@/sanity/lib/image';
import { postsByLocaleQuery } from '@/sanity/lib/queries';
import type { PostSummary } from '@/sanity/lib/types';
import { createCorePageMetadata } from '@/lib/seo';
import { RetryButton } from '@/components/blog/RetryButton';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return createCorePageMetadata(locale, 'blog');
}

function formatDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(
    locale === 'zh' ? 'zh-Hans-CN' : locale === 'id' ? 'id-ID' : 'en-US',
    { year: 'numeric', month: 'long', day: 'numeric' }
  );
}

export default async function BlogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'blog' });
  const ux = await getTranslations({ locale, namespace: 'blogUx' });
  const guide = await getTranslations({ locale, namespace: 'experience.guide' });
  const { notice } = await searchParams;

  let posts: PostSummary[] = [];
  let unavailable = false;
  if (isSanityConfigured) {
    try {
      posts = await sanityFetch<PostSummary[]>({ query: postsByLocaleQuery, params: { locale } });
    } catch {
      unavailable = true;
    }
  }

  return (
    <>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-surface">
      <section className="pt-32 pb-24 px-6 md:px-12 max-w-4xl mx-auto">
        <div className="mb-16">
          <p className="text-sm uppercase tracking-[0.4em] text-primary font-bold">
            {t('label')}
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mt-4 mb-4">
            {t('heading')}
          </h1>
          <p className="text-gray-600 max-w-2xl">{t('description')}</p>
        </div>

        {notice === 'translation-unavailable' && (
          <p role="status" className="mb-8 rounded-xl border border-line bg-surface-muted p-5 text-base text-on-surface-variant">
            {ux('translationUnavailable')}
          </p>
        )}

        <article className="mb-10 rounded-2xl border border-line bg-surface-muted p-6 md:p-8">
          <p className="mb-3 text-sm font-bold uppercase tracking-wider text-brand">{ux('practicalGuide')}</p>
          <h2 className="mb-4 text-2xl md:text-3xl">{guide('title')}</h2>
          <p className="mb-6 text-base leading-relaxed text-on-surface-variant">{guide('description')}</p>
          <Link href="/guides/workflow-audit" className="inline-flex items-center gap-2 rounded-lg py-2 font-semibold text-brand hover:underline underline-offset-4">
            {guide('read')} <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </article>

        {unavailable ? (
          <div className="rounded-2xl border border-line bg-card p-6 md:p-8">
            <h2 className="mb-3 text-2xl">{ux('unavailableTitle')}</h2>
            <p role="status" className="mb-6 text-base text-on-surface-variant">{ux('unavailableBody')}</p>
            <RetryButton />
          </div>
        ) : posts.length === 0 ? (
          <div className="rounded-3xl border border-gray-200 p-10 bg-gray-50 text-center">
            <h2 className="text-2xl font-semibold mb-3">{ux('moreSoonTitle')}</h2>
            <p className="text-gray-500 max-w-md mx-auto">{ux('moreSoonBody')}</p>
          </div>
        ) : (
          <div className="grid gap-8">
            {posts.map((post: PostSummary) => (
              <article
                key={post._id}
                className="group rounded-2xl border border-gray-200 bg-card overflow-hidden hover:shadow-lg transition-shadow"
              >
                <Link href={`/blog/${post.slug}`} className="block">
                  {post.mainImage && (
                    <div className="aspect-[16/7] overflow-hidden bg-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={urlFor(post.mainImage).width(800).height(350).fit('crop').url()}
                        alt={(post.mainImage as { alt?: string }).alt ?? post.title}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    </div>
                  )}

                  <div className="p-8">
                    <div className="flex flex-wrap gap-2 mb-4">
                      {post.categories?.map((cat) => (
                        <span
                          key={cat.slug}
                          className="text-xs font-semibold text-primary bg-primary/5 px-3 py-1 rounded-full"
                        >
                          {cat.title}
                        </span>
                      ))}
                    </div>

                    <h2 className="text-2xl font-bold mb-3 group-hover:text-primary transition-colors">
                      {post.title}
                    </h2>

                    {post.excerpt && (
                      <p className="text-gray-600 mb-5 leading-relaxed line-clamp-3">
                        {post.excerpt}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="text-sm text-gray-400">
                        {post.publishedAt && formatDate(post.publishedAt, locale)}
                        {post.author?.name && (
                          <span className="ml-2">· {post.author.name}</span>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1 text-primary text-sm font-semibold group-hover:gap-2 transition-all">
                        {t('readMore')} <ArrowRight className="w-4 h-4" />
                      </span>
                    </div>
                  </div>
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
      </main>
      <Footer />
    </>
  );
}
