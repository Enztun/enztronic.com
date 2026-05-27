import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Link } from '@/i18n/navigation';
import { client, isSanityConfigured } from '@/sanity/lib/client';
import { urlFor } from '@/sanity/lib/image';
import { postsByLocaleQuery, postsQuery } from '@/sanity/lib/queries';
import type { PostSummary } from '@/sanity/lib/types';

const BASE = 'https://enztronic.com';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta.blog' });
  const canonical = locale === 'en' ? `${BASE}/blog` : `${BASE}/${locale}/blog`;

  return {
    title: t('title'),
    description: t('description'),
    alternates: {
      canonical,
      languages: {
        en: `${BASE}/blog`,
        id: `${BASE}/id/blog`,
        'zh-Hans': `${BASE}/zh/blog`,
        'x-default': `${BASE}/blog`,
      },
    },
    openGraph: { title: t('title'), description: t('description'), url: canonical },
  };
}

function formatDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(
    locale === 'zh' ? 'zh-Hans-CN' : locale === 'id' ? 'id-ID' : 'en-US',
    { year: 'numeric', month: 'long', day: 'numeric' }
  );
}

export default async function BlogPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'blog' });

  let posts: PostSummary[] = [];
  if (isSanityConfigured) {
    try {
      posts = await client.fetch(postsByLocaleQuery, { locale });
      if (posts.length === 0 && locale !== 'en') {
        posts = await client.fetch(postsByLocaleQuery, { locale: 'en' });
      }
      if (posts.length === 0) {
        posts = await client.fetch(postsQuery);
      }
    } catch {
      // Sanity not reachable — show empty state
    }
  }

  return (
    <main className="min-h-screen bg-white">
      <Navbar />

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

        {posts.length === 0 ? (
          <div className="rounded-3xl border border-gray-200 p-10 bg-gray-50 text-center">
            <p className="text-sm text-gray-400 uppercase tracking-[0.2em] mb-3">
              {t('comingSoon')}
            </p>
            <h2 className="text-2xl font-semibold mb-3">{t('placeholder')}</h2>
            <p className="text-gray-500 max-w-md mx-auto">{t('placeholderDetail')}</p>
          </div>
        ) : (
          <div className="grid gap-8">
            {posts.map((post: PostSummary) => (
              <article
                key={post._id}
                className="group rounded-2xl border border-gray-200 bg-white overflow-hidden hover:shadow-lg transition-shadow"
              >
                <Link href={`/blog/${post.slug}`} className="block">
                  {post.mainImage && (
                    <div className="aspect-[16/7] overflow-hidden bg-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={urlFor(post.mainImage).width(800).height(350).fit('crop').url()}
                        alt={(post.mainImage as { alt?: string }).alt ?? post.title}
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

                    <div className="flex items-center justify-between">
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

      <Footer />
    </main>
  );
}
