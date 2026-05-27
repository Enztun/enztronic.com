import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PortableText } from 'next-sanity';
import { ArrowLeft, Phone } from 'lucide-react';
import {
  Target, Megaphone, Code, Palette, TrendingUp, Users,
  BarChart2, Search, CheckCircle, Star, Zap, Globe, Layout, Shield, Pencil, Lightbulb,
  MessageCircle,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Link } from '@/i18n/navigation';
import { client, isSanityConfigured } from '@/sanity/lib/client';
import { urlFor } from '@/sanity/lib/image';
import { postBySlugQuery, postSlugsQuery } from '@/sanity/lib/queries';
import { ShareButtons } from '@/components/blog/ShareButtons';
import { TableOfContents, type TocHeading } from '@/components/blog/TableOfContents';

const BASE = 'https://enztronic.com';

// ─── helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function extractHeadings(body: unknown): TocHeading[] {
  if (!Array.isArray(body)) return [];
  return body
    .filter(
      (b: { _type?: string; style?: string }) =>
        b._type === 'block' && (b.style === 'h2' || b.style === 'h3')
    )
    .map((b: { style: string; children?: Array<{ text?: string }> }) => {
      const text = (b.children ?? []).map((c) => c.text ?? '').join('');
      return { id: slugify(text), text, level: b.style === 'h2' ? 2 : 3 } as TocHeading;
    })
    .filter((h) => h.text.length > 0);
}

function readTime(body: unknown): number {
  if (!Array.isArray(body)) return 1;
  let words = 0;
  body.forEach((b: { _type?: string; children?: Array<{ text?: string }> }) => {
    if (b._type === 'block' && Array.isArray(b.children)) {
      b.children.forEach((c) => {
        if (c.text) words += c.text.split(/\s+/).filter(Boolean).length;
      });
    }
  });
  return Math.max(1, Math.ceil(words / 200));
}

function formatDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(
    locale === 'zh' ? 'zh-Hans-CN' : locale === 'id' ? 'id-ID' : 'en-US',
    { year: 'numeric', month: 'long', day: 'numeric' }
  );
}

// If the body's first block is the same image as mainImage, drop it to avoid a duplicate hero.
function deduplicateBody(body: unknown, mainImageRef?: string): unknown {
  if (!Array.isArray(body) || !mainImageRef) return body;
  const first = body[0] as { _type?: string; asset?: { _ref?: string } };
  if (first?._type === 'image' && first?.asset?._ref === mainImageRef) {
    return body.slice(1);
  }
  return body;
}

// ─── icon map for iconGrid ─────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  target: Target,
  megaphone: Megaphone,
  code: Code,
  palette: Palette,
  'trending-up': TrendingUp,
  users: Users,
  'bar-chart': BarChart2,
  search: Search,
  'check-circle': CheckCircle,
  star: Star,
  zap: Zap,
  globe: Globe,
  layout: Layout,
  shield: Shield,
  pencil: Pencil,
  lightbulb: Lightbulb,
};

// ─── custom block renderers ────────────────────────────────────────────────────

const COL_CLASS: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 md:grid-cols-3',
  4: 'grid-cols-2 md:grid-cols-4',
  6: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6',
};

type ImageGridItem = { image?: Record<string, unknown>; alt?: string; title?: string; caption?: string };
type ImageGridValue = { items?: ImageGridItem[]; columns?: number };

function ImageGridBlock({ value }: { value: ImageGridValue }) {
  const cols = value.columns ?? 4;
  const colClass = COL_CLASS[cols] ?? COL_CLASS[4];
  return (
    <div className={`grid ${colClass} gap-4 my-8`}>
      {(value.items ?? []).map((item, i) => (
        <div key={i} className="space-y-2">
          {item.image && (
            <div className="rounded-lg overflow-hidden aspect-square bg-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={urlFor(item.image).width(400).height(400).fit('crop').url()}
                alt={item.alt ?? item.title ?? ''}
                className="w-full h-full object-cover"
              />
            </div>
          )}
          {item.title && <p className="text-sm font-semibold text-gray-800 leading-snug">{item.title}</p>}
          {item.caption && <p className="text-xs text-gray-500">{item.caption}</p>}
        </div>
      ))}
    </div>
  );
}

type IconGridItem = { icon?: string; title?: string; description?: string };
type IconGridValue = { heading?: string; items?: IconGridItem[]; columns?: number };

function IconGridBlock({ value }: { value: IconGridValue }) {
  const cols = value.columns ?? 3;
  const colClass = COL_CLASS[cols] ?? COL_CLASS[3];
  return (
    <div className="my-8">
      {value.heading && (
        <h2 className="text-2xl font-bold mb-6">{value.heading}</h2>
      )}
      <div className={`grid ${colClass} gap-6`}>
        {(value.items ?? []).map((item, i) => {
          const Icon = item.icon ? (ICON_MAP[item.icon] ?? Target) : Target;
          return (
            <div key={i} className="flex flex-col gap-2">
              <Icon className="w-7 h-7 text-primary" />
              <p className="font-semibold text-gray-900 text-sm">{item.title}</p>
              {item.description && <p className="text-sm text-gray-500 leading-snug">{item.description}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type SideBySideValue = {
  image?: Record<string, unknown>;
  imagePosition?: 'left' | 'right';
  heading?: string;
  body?: string;
  emphasis?: string;
  ctaText?: string;
  ctaHref?: string;
};

function SideBySideBlock({ value }: { value: SideBySideValue }) {
  const imgRight = value.imagePosition === 'right';
  return (
    <div className={`grid md:grid-cols-2 gap-8 items-center my-8 ${imgRight ? 'md:[direction:ltr]' : ''}`}>
      {value.image && (
        <div className={`rounded-xl overflow-hidden ${imgRight ? 'md:order-2' : ''}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={urlFor(value.image).width(600).height(500).fit('crop').url()}
            alt={(value.image?.alt as string | undefined) ?? value.heading ?? ''}
            className="w-full h-full object-cover"
          />
        </div>
      )}
      <div className={imgRight ? 'md:order-1' : ''}>
        {value.heading && <h3 className="text-xl font-bold mb-3">{value.heading}</h3>}
        {value.body && <p className="text-gray-600 leading-relaxed mb-3">{value.body}</p>}
        {value.emphasis && (
          <p className="font-bold text-gray-900">{value.emphasis}</p>
        )}
        {value.ctaText && value.ctaHref && (
          <a
            href={value.ctaHref}
            className="inline-flex items-center gap-2 mt-4 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            {value.ctaText}
          </a>
        )}
      </div>
    </div>
  );
}

type CtaButton = { text?: string; href?: string; style?: string };
type CtaBlockValue = { headline?: string; subheading?: string; buttons?: CtaButton[]; theme?: string };

function ctaBtnClass(style?: string) {
  switch (style) {
    case 'whatsapp': return 'bg-green-500 hover:bg-green-600 text-white inline-flex items-center gap-2';
    case 'phone': return 'bg-white/10 border border-white/30 text-white hover:bg-white/20 inline-flex items-center gap-2';
    case 'outline': return 'border-2 border-white text-white hover:bg-white/10 inline-flex items-center gap-2';
    default: return 'bg-primary hover:bg-blue-700 text-white inline-flex items-center gap-2';
  }
}

function CtaBlockComponent({ value }: { value: CtaBlockValue }) {
  const bg =
    value.theme === 'primary'
      ? 'bg-primary'
      : value.theme === 'light'
      ? 'bg-gray-100'
      : 'bg-gray-900';
  const textColor = value.theme === 'light' ? 'text-gray-900' : 'text-white';
  const subColor = value.theme === 'light' ? 'text-gray-600' : 'text-white/70';

  return (
    <div className={`${bg} rounded-2xl px-8 py-10 my-8`}>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div>
          {value.headline && (
            <h3 className={`text-2xl font-bold leading-snug ${textColor}`}>{value.headline}</h3>
          )}
          {value.subheading && (
            <p className={`mt-2 text-sm ${subColor}`}>{value.subheading}</p>
          )}
        </div>
        {(value.buttons ?? []).length > 0 && (
          <div className="flex flex-wrap gap-3 shrink-0">
            {(value.buttons ?? []).map((btn, i) => (
              <a
                key={i}
                href={btn.href ?? '#'}
                className={`rounded-full px-5 py-2.5 text-sm font-semibold transition-colors ${ctaBtnClass(btn.style)}`}
              >
                {btn.style === 'whatsapp' && <MessageCircle className="w-4 h-4" />}
                {btn.style === 'phone' && <Phone className="w-4 h-4" />}
                {btn.text}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── portable text components ─────────────────────────────────────────────────

const portableTextComponents = {
  types: {
    image: ({ value }: { value: { asset?: unknown; alt?: string; caption?: string } }) =>
      value?.asset ? (
        <figure className="my-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={urlFor(value).width(820).url()}
            alt={value.alt ?? ''}
            className="w-full rounded-xl"
          />
          {value.caption && (
            <figcaption className="text-center text-sm text-gray-400 mt-2 italic">
              {value.caption}
            </figcaption>
          )}
        </figure>
      ) : null,
    imageGrid: ({ value }: { value: ImageGridValue }) => <ImageGridBlock value={value} />,
    iconGrid: ({ value }: { value: IconGridValue }) => <IconGridBlock value={value} />,
    sideBySide: ({ value }: { value: SideBySideValue }) => <SideBySideBlock value={value} />,
    ctaBlock: ({ value }: { value: CtaBlockValue }) => <CtaBlockComponent value={value} />,
  },
  block: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h2: ({ children, value }: { children?: React.ReactNode; value?: any }) => {
      const text = (value?.children ?? []).map((c: { text?: string }) => c.text ?? '').join('');
      return (
        <h2 id={slugify(text)} className="text-2xl font-bold mt-12 mb-4 scroll-mt-24">
          {children}
        </h2>
      );
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h3: ({ children, value }: { children?: React.ReactNode; value?: any }) => {
      const text = (value?.children ?? []).map((c: { text?: string }) => c.text ?? '').join('');
      return (
        <h3 id={slugify(text)} className="text-xl font-bold mt-8 mb-3 scroll-mt-24">
          {children}
        </h3>
      );
    },
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="border-l-4 border-primary pl-5 italic text-gray-600 my-6 text-lg">
        {children}
      </blockquote>
    ),
    normal: ({ children }: { children?: React.ReactNode }) => (
      <p className="text-gray-700 leading-relaxed mb-5 text-[1.05rem]">{children}</p>
    ),
  },
  list: {
    bullet: ({ children }: { children?: React.ReactNode }) => (
      <ul className="list-disc pl-6 mb-5 space-y-2 text-gray-700">{children}</ul>
    ),
    number: ({ children }: { children?: React.ReactNode }) => (
      <ol className="list-decimal pl-6 mb-5 space-y-2 text-gray-700">{children}</ol>
    ),
  },
  marks: {
    strong: ({ children }: { children?: React.ReactNode }) => (
      <strong className="font-bold text-gray-900">{children}</strong>
    ),
    em: ({ children }: { children?: React.ReactNode }) => (
      <em className="italic">{children}</em>
    ),
    code: ({ children }: { children?: React.ReactNode }) => (
      <code className="bg-gray-100 rounded px-1.5 py-0.5 text-sm font-mono text-gray-800">
        {children}
      </code>
    ),
    link: ({
      value,
      children,
    }: {
      value?: { href?: string };
      children?: React.ReactNode;
    }) => (
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

// ─── static params ─────────────────────────────────────────────────────────────

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

// ─── metadata ─────────────────────────────────────────────────────────────────

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

// ─── page ─────────────────────────────────────────────────────────────────────

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

  const mainImageRef = (post.mainImage as { asset?: { _ref?: string } } | null)?.asset?._ref;
  const dedupedBody = deduplicateBody(post.body, mainImageRef);
  const headings = extractHeadings(dedupedBody);
  const mins = readTime(dedupedBody);
  const canonicalUrl =
    locale === 'en' ? `${BASE}/blog/${slug}` : `${BASE}/${locale}/blog/${slug}`;

  const authorInitial = post.author?.name?.charAt(0)?.toUpperCase() ?? 'E';

  return (
    <main className="min-h-screen bg-white">
      <Navbar />

      {/* ── article header ── */}
      <div className="pt-32 pb-8 px-6 md:px-12 max-w-6xl mx-auto">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-primary transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('label')}
        </Link>

        {post.categories && post.categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            {post.categories.map((cat: { title: string; slug: string }) => (
              <span
                key={cat.slug}
                className="text-xs font-bold uppercase tracking-widest text-primary"
              >
                {cat.title}
              </span>
            ))}
          </div>
        )}

        <h1 className="text-3xl md:text-5xl font-bold leading-tight mb-5 max-w-3xl">
          {post.title}
        </h1>

        {post.excerpt && (
          <p className="text-lg text-gray-500 max-w-2xl mb-6 leading-relaxed">{post.excerpt}</p>
        )}

        <div className="flex items-center gap-3 text-sm text-gray-400">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white font-bold text-sm">
            {authorInitial}
          </div>
          <span className="font-medium text-gray-700">
            {t('by')} {post.author?.name ?? 'Enztronic'}
          </span>
          {post.publishedAt && (
            <>
              <span>·</span>
              <span>{formatDate(post.publishedAt, locale)}</span>
            </>
          )}
          <span>·</span>
          <span>
            {mins} {t('minRead')}
          </span>
        </div>
      </div>

      {/* ── hero image ── */}
      {post.mainImage && (
        <div className="px-6 md:px-12 max-w-6xl mx-auto mb-10">
          <div className="rounded-2xl overflow-hidden aspect-[16/7] bg-gray-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={urlFor(post.mainImage).width(1200).height(525).fit('crop').url()}
              alt={(post.mainImage as { alt?: string }).alt ?? post.title}
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      )}

      {/* ── 2-col content ── */}
      <div className="px-6 md:px-12 max-w-6xl mx-auto pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-16">
          {/* main body */}
          <div className="min-w-0">
            {Array.isArray(dedupedBody) && dedupedBody.length > 0 && (
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              <PortableText value={dedupedBody as any} components={portableTextComponents} />
            )}
          </div>

          {/* sticky sidebar */}
          <aside className="hidden lg:block">
            <div className="sticky top-28 space-y-8">
              <ShareButtons
                url={canonicalUrl}
                title={post.title}
                label={t('share')}
              />
              <div className="border-t border-gray-100 pt-8">
                <TableOfContents headings={headings} label={t('toc')} />
              </div>
            </div>
          </aside>
        </div>
      </div>

      <Footer />
    </main>
  );
}
