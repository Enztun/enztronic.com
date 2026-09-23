import Image from 'next/image';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Link } from '@/i18n/navigation';
import { screenshotFor } from '@/lib/screenshots';
import { NextStepSection } from '@/components/sections/ExperienceSections';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: 'experience.caseStudy',
  });
  const url = (language: string) =>
    `https://enztronic.com${language === 'en' ? '' : `/${language}`}/portfolio/qianlima`;
  return {
    title: `${t('title')} | Enztronic`,
    description: t('description'),
    openGraph: {
      title: `${t('title')} | Enztronic`,
      description: t('description'),
      url: url(locale),
      type: 'article',
      images: [
        {
          url: screenshotFor('https://qianlima.co.id', 'laptop'),
          width: 1440,
          height: 900,
          alt: t('imageAlt'),
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
      images: [screenshotFor('https://qianlima.co.id', 'laptop')],
    },
    alternates: {
      canonical: url(locale),
      languages: {
        en: url('en'),
        id: url('id'),
        'zh-Hans': url('zh'),
        'x-default': url('en'),
      },
    },
  };
}

export default async function QianlimaCaseStudy({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const t = await getTranslations({
    locale: (await params).locale,
    namespace: 'experience.caseStudy',
  });
  const capabilities = t.raw('capabilities') as {
    title: string;
    body: string;
  }[];
  return (
    <>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-surface">
      <article className="max-w-7xl mx-auto px-6 md:px-12 pt-32 pb-10">
        <Link
          href="/portfolio"
          className="inline-flex items-center gap-2 text-brand font-semibold mb-8"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {t('back')}
        </Link>
        <header className="max-w-4xl mb-10">
          <p className="text-brand font-bold uppercase tracking-wider text-sm mb-4">
            {t('label')}
          </p>
          <h1 className="text-4xl md:text-6xl leading-tight mb-6">
            {t('title')}
          </h1>
          <p className="text-lg md:text-xl text-on-surface-variant leading-relaxed">
            {t('description')}
          </p>
        </header>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.25fr)] items-end gap-3 md:gap-6 mb-16">
          <Image
            src={screenshotFor('https://qianlima.co.id', 'laptop')}
            width={1440}
            height={900}
            alt={t('imageAlt')}
            priority
            sizes="(min-width: 1024px) 70vw, 72vw"
            className="w-full aspect-[16/10] object-cover object-top rounded-xl border border-line shadow-sm"
          />
          <Image
            src={screenshotFor('https://qianlima.co.id', 'mobile')}
            width={585}
            height={1266}
            alt=""
            aria-hidden="true"
            sizes="(min-width: 1024px) 18vw, 20vw"
            className="w-full aspect-[9/16] object-cover object-top rounded-lg border border-line shadow-sm"
          />
        </div>
        <div className="grid gap-10 lg:grid-cols-2 mb-12">
          <section>
            <h2 className="text-2xl md:text-3xl mb-4">{t('contextHeading')}</h2>
            <p className="text-on-surface-variant leading-relaxed">
              {t('context')}
            </p>
          </section>
          <section>
            <h2 className="text-2xl md:text-3xl mb-4">{t('scopeHeading')}</h2>
            <p className="text-on-surface-variant leading-relaxed">
              {t('scope')}
            </p>
          </section>
        </div>
        <div className="grid sm:grid-cols-2 gap-5 mb-16">
          {capabilities.map((item) => (
            <section
              key={item.title}
              className="rounded-2xl bg-surface-muted border border-line p-6"
            >
              <h3 className="text-xl mb-3">{item.title}</h3>
              <p className="text-on-surface-variant leading-relaxed">
                {item.body}
              </p>
            </section>
          ))}
        </div>
        <section className="mb-16">
          <h2 className="text-2xl md:text-3xl mb-6">{t('workflowHeading')}</h2>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(t.raw('workflow') as string[]).map((step, index) => (
              <li key={step} className="border-t-2 border-brand pt-4">
                <span className="block mb-3 text-brand font-bold">
                  0{index + 1}
                </span>
                <p className="font-semibold">{step}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="max-w-3xl">
          <h2 className="text-2xl md:text-3xl mb-4">{t('outcomeHeading')}</h2>
          <p className="text-on-surface-variant leading-relaxed mb-7">
            {t('outcome')}
          </p>
          <div className="flex flex-wrap gap-x-8 gap-y-5">
            <Link
              href="/contact?service=saas"
              className="inline-flex items-center gap-2 text-brand font-bold"
            >
              {t('discuss')}{' '}
              <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
            </Link>
            <a
              href="https://qianlima.co.id"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-on-surface-variant font-semibold"
            >
              {t('live')}{' '}
              <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
            </a>
            <Link
              href="/services#platforms"
              className="inline-flex items-center gap-2 text-brand font-semibold"
            >
              {t('related')}
            </Link>
          </div>
        </section>
      </article>
      <NextStepSection />
      </main>
      <Footer />
    </>
  );
}
