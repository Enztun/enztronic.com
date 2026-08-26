import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { draftMode } from 'next/headers';
import { VisualEditing } from 'next-sanity/visual-editing';
import { routing } from '@/i18n/routing';
import { ThemeScript } from '@/components/ThemeToggle';
import ChatWidget from '@/components/chat/ChatWidget';
import '../globals.css';

// Montserrat is the single brand typeface. The site previously loaded Geist
// while the stylesheet asked for Inter, so neither was applied consistently.
const montserrat = Montserrat({
  variable: '--font-montserrat',
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

const BASE = 'https://enztronic.com';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta.home' });

  return {
    title: t('title'),
    description: t('description'),
    metadataBase: new URL(BASE),
    openGraph: {
      title: t('title'),
      description: t('description'),
      siteName: 'Enztronic',
      type: 'website',
      locale:
        locale === 'zh' ? 'zh_CN' : locale === 'id' ? 'id_ID' : 'en_US',
      images: [{ url: '/og-image', width: 1200, height: 630, alt: 'Enztronic' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
      images: ['/og-image'],
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as 'en' | 'id' | 'zh')) {
    notFound();
  }

  const messages = await getMessages();
  const t = await getTranslations({ locale, namespace: 'meta.home' });
  const { isEnabled: isDraftMode } = await draftMode();
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${BASE}/#organization`,
        name: 'Enztronic',
        url: BASE,
        description: t('description'),
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'Jakarta',
          addressCountry: 'ID',
        },
        knowsAbout: [
          'AI Automation',
          'System Integration',
          'SaaS Development',
          'Digital Product Development',
        ],
      },
      {
        '@type': 'WebSite',
        '@id': `${BASE}/#website`,
        url: BASE,
        name: 'Enztronic',
        publisher: { '@id': `${BASE}/#organization` },
        inLanguage: ['en', 'id', 'zh-Hans'],
      },
    ],
  };

  return (
    <html
      lang={locale === 'zh' ? 'zh-Hans' : locale}
      className={`${montserrat.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider messages={messages}>
          {children}
          <ChatWidget />
          {isDraftMode && <VisualEditing />}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
