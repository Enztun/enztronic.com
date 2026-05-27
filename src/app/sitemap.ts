import type { MetadataRoute } from 'next';

const BASE = 'https://enztronic.com';
const pages = ['', 'about', 'services', 'portfolio', 'blog', 'contact'];
const locales = ['en', 'id', 'zh'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return pages.map((page) => {
    const slug = page ? `/${page}` : '';
    return {
      url: `${BASE}${slug}`,
      lastModified: new Date(),
      changeFrequency: page === '' ? 'weekly' : 'monthly',
      priority: page === '' ? 1.0 : 0.8,
      alternates: {
        languages: Object.fromEntries(
          locales.map((l) => [
            l === 'zh' ? 'zh-Hans' : l,
            l === 'en' ? `${BASE}${slug}` : `${BASE}/${l}${slug}`,
          ])
        ),
      },
    };
  });
}
