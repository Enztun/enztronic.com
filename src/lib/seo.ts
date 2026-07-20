import 'server-only';

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { isSanityConfigured } from '@/sanity/lib/client';
import { sanityFetch } from '@/sanity/lib/fetch';
import { pageSeoBySlugQuery } from '@/sanity/lib/queries';

const BASE = 'https://enztronic.com';

type CorePage = 'home' | 'about' | 'services' | 'portfolio' | 'blog' | 'contact';

const PATHS: Record<CorePage, string> = {
  home: '',
  about: '/about',
  services: '/services',
  portfolio: '/portfolio',
  blog: '/blog',
  contact: '/contact',
};

const CMS_PAGES = new Set<CorePage>(['home', 'about', 'services', 'portfolio']);

function localizedUrl(locale: string, path: string) {
  return locale === 'en' ? `${BASE}${path}` : `${BASE}/${locale}${path}`;
}

function titleWithBrand(title: string) {
  return /enztronic/i.test(title) ? title : `${title} | Enztronic`;
}

export async function createCorePageMetadata(
  locale: string,
  page: CorePage
): Promise<Metadata> {
  const namespace = `meta.${page}` as
    | 'meta.home'
    | 'meta.about'
    | 'meta.services'
    | 'meta.portfolio'
    | 'meta.blog'
    | 'meta.contact';
  const t = await getTranslations({ locale, namespace });

  let title = t('title');
  let description = t('description');

  if (CMS_PAGES.has(page) && isSanityConfigured) {
    try {
      const seo = await sanityFetch<{
        seoTitle?: string | null;
        seoDescription?: string | null;
      } | null>({
        query: pageSeoBySlugQuery,
        params: { slug: page, language: locale },
      });
      title = seo?.seoTitle?.trim() || title;
      description = seo?.seoDescription?.trim() || description;
    } catch {
      // Translation metadata remains a safe fallback if Sanity is unavailable.
    }
  }

  title = titleWithBrand(title);
  const path = PATHS[page];
  const canonical = localizedUrl(locale, path);
  const image = `${BASE}/og-image`;

  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical,
      languages: {
        en: localizedUrl('en', path),
        id: localizedUrl('id', path),
        'zh-Hans': localizedUrl('zh', path),
        'x-default': localizedUrl('en', path),
      },
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: 'Enztronic',
      type: 'website',
      locale: locale === 'zh' ? 'zh_CN' : locale === 'id' ? 'id_ID' : 'en_US',
      images: [{ url: image, width: 1200, height: 630, alt: 'Enztronic' }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
}
