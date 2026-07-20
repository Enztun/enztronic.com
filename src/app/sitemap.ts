import type { MetadataRoute } from 'next';
import { client, isSanityConfigured } from '@/sanity/lib/client';
import { postSitemapQuery } from '@/sanity/lib/queries';

const BASE = 'https://enztronic.com';
const PAGES = ['', '/about', '/services', '/portfolio', '/blog', '/contact'];
const LOCALES = ['en', 'id', 'zh'] as const;

type Locale = (typeof LOCALES)[number];
type SitemapPost = { slug: string; locale: string; _updatedAt: string };

export const revalidate = 3600;

function localizedUrl(locale: Locale, path: string) {
  return locale === 'en' ? `${BASE}${path}` : `${BASE}/${locale}${path}`;
}

function languageTag(locale: Locale) {
  return locale === 'zh' ? 'zh-Hans' : locale;
}

function staticEntries(): MetadataRoute.Sitemap {
  return PAGES.flatMap((path) =>
    LOCALES.map((locale) => ({
      url: localizedUrl(locale, path),
      changeFrequency: path === '' ? ('weekly' as const) : ('monthly' as const),
      priority: path === '' ? 1 : 0.8,
      alternates: {
        languages: {
          ...Object.fromEntries(
            LOCALES.map((alternateLocale) => [
              languageTag(alternateLocale),
              localizedUrl(alternateLocale, path),
            ])
          ),
          'x-default': localizedUrl('en', path),
        },
      },
    }))
  );
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries = staticEntries();
  if (!isSanityConfigured) return entries;

  try {
    const posts = await client.fetch<SitemapPost[]>(postSitemapQuery);
    const postEntries: MetadataRoute.Sitemap = posts.flatMap((post) => {
      if (!LOCALES.includes(post.locale as Locale)) return [];
      const locale = post.locale as Locale;
      return [
        {
          url: localizedUrl(locale, `/blog/${post.slug}`),
          lastModified: post._updatedAt,
          changeFrequency: 'monthly' as const,
          priority: 0.7,
        },
      ];
    });
    return [...entries, ...postEntries];
  } catch {
    return entries;
  }
}
