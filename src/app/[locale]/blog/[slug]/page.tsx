import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PortableText } from 'next-sanity';
import { ArrowLeft } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Link } from '@/i18n/navigation';
import { client, isSanityConfigured } from '@/sanity/lib/client';
import { urlFor } from '@/sanity/lib/image';
import { postBySlugQuery, postSlugsQuery } from '@/sanity/lib/queries';

const BASE = 'https://enztronic.com';

export async function generateStaticParams() {
  if (!isSanityConfigured) return [];
  try {
    const slugs = await client.fetch(postSlugsQuery);
    return slugs.map((item: { slug: string; language: string | null }) => ({
      slug: item.slug,
      locale: item.language ?? 'en',
    }));
  } catch {
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isSanityConfigured) return {};
  let post;
  try {
    post = await client.fetch(postBySlugQuery, { slug });
  } catch {
    return {};
  }
  if (!post) return {};

  const canonical =
    locale === 'en' ? `${BASE}/blog/${slug}` : `${BASE}/${locale}/blog/${slug}`;

  return {
    title: `${post.title} | Enztronic Blog`,
    description: post.excerpt ?? undefined,
    alternates: {
      canonical,
      languages: {
        en: `${BASE}/blog/${slug}`,
        id: `${BASE}/id/blog/${slug}`,
        'zh-Hans': `${BASE}/zh/blog/${slug}`,
        'x-default': `${BASE}/blog/${slug}`,
      },
    },
    openGraph: {
      title: post.title,
      description: post.excerpt ?? undefined,
      url: canonical,
      type: 'article',
      publishedTime: post.publishedAt ?? undefined,
      ...(post.mainImage && {
        images: [urlFor(post.mainImage).width(1200).height(630).fit('crop').url()],
      }),
    },
  };
}

function formatDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(
    locale === 'zh' ? 'zh-Hans-CN' : locale === 'id' ? 'id-ID' : 'en-US',
    { year: 'numeric', month: 'long', day: 'numeric' }
  );
}

const portableTextComponents = {
  types: {
    image: ({ value }: { value: { asset?: unknown; alt?: string; caption?: string } }) =>
      value?.asset ? (
        <figure className="my-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={urlFor(value).width(800).url()}
            alt={value.alt ?? ''}
            className="w-full rounded-xl"
          />
          {value.caption && (
            <figcaption className="text-center text-sm text-gray-400 mt-2">
              {value.caption}
            </figcaption>
          )}
        </figure>
      ) : null,
  },
  block: {
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 className="text-2xl font-bold mt-10 mb-4">{children}</h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 className="text-xl font-bold mt-8 mb-3">{children}</h3>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="border-l-4 border-primary pl-5 italic text-gray-600 my-6">
        {children}
      </blockquote>
    ),
    normal: ({ children }: { children?: React.ReactNode }) => (
      <p className="text-gray-700 leading-relaxed mb-5">{children}</p>
    ),
  },
  marks: {
    code: ({ children }: { children?: React.ReactNode }) => (
      <code className="bg-gray-100 rounded px-1.5 py-0.5 text-sm font-mono">{children}</code>
    ),
    link: ({ value, children }: { value?: { href?: string }; children?: React.ReactNode }) => (
      <a
        href={value?.href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:opacity-80"
      >
        {children}
      </a>
    ),
  },
};

export default async function PostPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: 'blog' });

  if (!isSanityConfigured) notFound();
  let post;
  try {
    post = await client.fetch(postBySlugQuery, { slug });
  } catch {
    notFound();
  }
  if (!post) notFound();

  return (
    <main className="min-h-screen bg-white">
      <Navbar />

      <article className="pt-32 pb-24 px-6 md:px-12 max-w-3xl mx-auto">
        {/* Back link */}
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-primary transition-colors mb-10"
        >
          <ArrowLeft className="w-4 h-4" /> {t('label')}
        </Link>

        {/* Categories */}
        {post.categories && post.categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            {post.categories.map((cat: { title: string; slug: string }) => (
              <span
                key={cat.slug}
                className="text-xs font-semibold text-primary bg-primary/5 px-3 py-1 rounded-full"
              >
                {cat.title}
              </span>
            ))}
          </div>
        )}

        {/* Title */}
        <h1 className="text-3xl md:text-5xl font-bold leading-tight mb-6">{post.title}</h1>

        {/* Meta */}
        <div className="flex items-center gap-3 text-sm text-gray-400 mb-10 pb-8 border-b border-gray-100">
          {post.publishedAt && <span>{formatDate(post.publishedAt, locale)}</span>}
          {post.author?.name && (
            <>
              <span>·</span>
              <span>{post.author.name}</span>
            </>
          )}
        </div>

        {/* Hero image */}
        {post.mainImage && (
          <div className="rounded-2xl overflow-hidden mb-10 aspect-[16/9] bg-gray-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={urlFor(post.mainImage).width(800).height(450).fit('crop').url()}
              alt={(post.mainImage as { alt?: string }).alt ?? post.title}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Body */}
        {post.body && (
          <div className="prose-enztronic">
            <PortableText value={post.body} components={portableTextComponents} />
          </div>
        )}
      </article>

      <Footer />
    </main>
  );
}
