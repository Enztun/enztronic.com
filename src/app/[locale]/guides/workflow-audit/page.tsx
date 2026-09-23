import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Link } from '@/i18n/navigation';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'experience.guide' });
  const url = (language: string) =>
    `https://enztronic.com${language === 'en' ? '' : `/${language}`}/guides/workflow-audit`;
  return {
    title: `${t('title')} | Enztronic`,
    description: t('description'),
    openGraph: {
      title: `${t('title')} | Enztronic`,
      description: t('description'),
      url: url(locale),
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
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

export default async function WorkflowGuide({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const t = await getTranslations({
    locale: (await params).locale,
    namespace: 'experience.guide',
  });
  const steps = t.raw('steps') as { title: string; body: string }[];
  return (
    <>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-surface">
      <article className="mx-auto max-w-4xl px-6 md:px-12 pt-32 pb-20">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-brand font-semibold mb-8"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {t('back')}
        </Link>
        <header className="mb-10">
          <p className="text-brand font-bold uppercase tracking-wider text-sm mb-4">
            {t('label')}
          </p>
          <h1 className="text-4xl md:text-5xl mb-6 leading-tight">
            {t('title')}
          </h1>
          <p className="text-xl text-on-surface-variant leading-relaxed">
            {t('description')}
          </p>
        </header>
        <p className="text-lg text-on-surface-variant leading-relaxed mb-10">
          {t('intro')}
        </p>
        <ol className="space-y-9">
          {steps.map((step, index) => (
            <li
              key={step.title}
              id={`step-${index + 1}`}
              className="scroll-mt-28"
            >
              <h2 className="text-2xl mb-3">
                <span className="text-brand">{index + 1}. </span>
                {step.title}
              </h2>
              <p className="text-on-surface-variant text-lg leading-relaxed">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
        <section className="my-12 border border-line bg-surface-muted rounded-2xl p-6 md:p-8">
          <h2 className="text-2xl mb-4">{t('exampleHeading')}</h2>
          <p className="text-on-surface-variant leading-relaxed">
            {t('example')}
          </p>
        </section>
        <section>
          <h2 className="text-2xl mb-5">{t('checklistHeading')}</h2>
          <ul className="space-y-4">
            {(t.raw('checklist') as string[]).map((item) => (
              <li key={item} className="flex items-start gap-3">
                <CheckCircle2
                  aria-hidden="true"
                  className="h-5 w-5 mt-0.5 shrink-0 text-brand"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/contact?service=automation"
            className="mt-8 inline-flex items-center justify-center gap-2 rounded-full bg-brand-fill text-white px-6 py-4 font-bold hover:bg-brand-fill-strong transition-colors"
          >
            {t('cta')}{' '}
            <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
          </Link>
        </section>
      </article>
      </main>
      <Footer />
    </>
  );
}
