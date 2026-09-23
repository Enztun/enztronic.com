import { getTranslations } from 'next-intl/server';
import {
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  MessageCircle,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { SERVICE_LINKS, serviceEnquiry } from './service-links';

type Item = { title: string; body: string };

export async function WorkflowSection() {
  const t = await getTranslations('experience.workflow');
  const steps = t.raw('steps') as Item[];
  return (
    <section className="bg-surface-muted border-y border-line py-16 md:py-20">
      <div className="mx-auto max-w-7xl px-6 md:px-12">
        <div className="max-w-2xl mb-10">
          <p className="text-brand font-bold text-sm uppercase tracking-widest mb-3">
            {t('label')}
          </p>
          <h2 className="text-3xl md:text-4xl mb-4">{t('heading')}</h2>
          <p className="text-on-surface-variant leading-relaxed">
            {t('description')}
          </p>
        </div>
        <ol className="grid gap-4 md:grid-cols-4">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className="relative min-w-0 rounded-2xl border border-line bg-card p-6"
            >
              <span className="text-brand text-sm font-bold">0{index + 1}</span>
              <h3 className="text-lg mt-3 mb-2">{step.title}</h3>
              <p className="text-on-surface-variant leading-relaxed">
                {step.body}
              </p>
              {index < steps.length - 1 && (
                <>
                  <ArrowRight
                    aria-hidden="true"
                    className="hidden md:block absolute -right-3 top-7 z-10 h-6 w-6 rounded-full bg-surface-muted text-brand"
                  />
                  <ArrowDown
                    aria-hidden="true"
                    className="md:hidden absolute -bottom-3 left-7 z-10 h-6 w-6 rounded-full bg-surface-muted text-brand"
                  />
                </>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-6 text-on-surface-variant">{t('note')}</p>
        <Link
          href="/guides/workflow-audit"
          className="mt-5 inline-flex items-center gap-2 font-semibold text-brand hover:text-brand-strong"
        >
          {t('guide')} <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

export async function ProcessSection() {
  const t = await getTranslations('experience.process');
  const steps = t.raw('steps') as Item[];
  return (
    <section
      className="mx-auto max-w-7xl px-6 md:px-12 py-16 md:py-20"
      id="how-we-work"
    >
      <div className="max-w-2xl mb-10">
        <h2 className="text-3xl md:text-4xl mb-4">{t('heading')}</h2>
        <p className="text-on-surface-variant leading-relaxed">
          {t('description')}
        </p>
      </div>
      <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <li className="border-t-2 border-line pt-5" key={step.title}>
            <span className="text-brand font-bold text-sm">0{index + 1}</span>
            <h3 className="text-xl my-3">{step.title}</h3>
            <p className="text-on-surface-variant leading-relaxed">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export async function ServiceDetails() {
  const t = await getTranslations('experience.services');
  const tServices = await getTranslations('services');
  const services = tServices.raw('items') as { title: string }[];
  const details = t.raw('items') as {
    problem: string;
    approach: string;
    result: string;
    example: string;
  }[];
  return (
    <section
      className="mx-auto max-w-7xl px-6 md:px-12 pb-16 md:pb-20"
      aria-label={t('heading')}
    >
      <div className="space-y-8">
        {details.map((item, index) => (
          <article
            key={SERVICE_LINKS[index].id}
            id={SERVICE_LINKS[index].id}
            className="scroll-mt-28 rounded-2xl border border-line p-6 md:p-10"
          >
            <div className="grid gap-8 lg:grid-cols-[1fr_1.25fr]">
              <div>
                <h2 className="text-2xl md:text-3xl mb-4">
                  {services[index].title}
                </h2>
                <p className="text-on-surface-variant leading-relaxed mb-6">
                  {item.problem}
                </p>
                <Link
                  href={serviceEnquiry(index)}
                  className="inline-flex items-center gap-2 font-semibold text-brand hover:text-brand-strong"
                >
                  {t('discuss')}{' '}
                  <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
                </Link>
              </div>
              <dl className="space-y-5">
                {(['approach', 'result', 'example'] as const).map((key) => (
                  <div key={key}>
                    <dt className="font-bold mb-1">{t(key)}</dt>
                    <dd className="text-on-surface-variant leading-relaxed">
                      {item[key]}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export async function FaqSection() {
  const t = await getTranslations('experience.faq');
  const items = t.raw('items') as { question: string; answer: string }[];
  return (
    <section className="mx-auto max-w-4xl px-6 md:px-12 py-16 md:py-20">
      <h2 className="text-3xl md:text-4xl mb-8">{t('heading')}</h2>
      <div className="divide-y divide-line border-y border-line">
        {items.map((item) => (
          <details key={item.question} className="group py-5">
            <summary className="cursor-pointer font-semibold text-lg pr-3 marker:text-brand">
              {item.question}
            </summary>
            <p className="mt-4 text-on-surface-variant leading-relaxed">
              {item.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

export async function NextStepSection() {
  const t = await getTranslations('experience.next');
  return (
    <section className="mx-auto max-w-7xl px-6 md:px-12 py-16 md:py-20">
      <div className="surface-dark brand-glow rounded-3xl px-6 py-12 md:p-16">
        <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr] items-center">
          <div>
            <h2 className="text-3xl md:text-4xl mb-5">{t('heading')}</h2>
            <p className="text-white/80 text-lg leading-relaxed">{t('body')}</p>
            <ul className="mt-6 space-y-3">
              {(t.raw('points') as string[]).map((point) => (
                <li
                  key={point}
                  className="flex items-start gap-3 text-white/85"
                >
                  <CheckCircle2
                    aria-hidden="true"
                    className="h-5 w-5 shrink-0 mt-0.5 text-white"
                  />
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-3 lg:items-start">
            <Link
              href="/contact"
              className="inline-flex justify-center items-center gap-2 rounded-full bg-white text-navy px-7 py-4 font-bold hover:bg-white/90 transition-colors"
            >
              {t('cta')}{' '}
              <ArrowRight aria-hidden="true" className="h-5 w-5 shrink-0" />
            </Link>
            <a
              href="https://wa.me/6289637579728"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex justify-center items-center gap-2 rounded-full border border-white/40 text-white px-7 py-4 font-semibold hover:bg-white/10 transition-colors"
            >
              <MessageCircle aria-hidden="true" className="h-5 w-5 shrink-0" />
              {t('whatsapp')}
            </a>
            <p className="mt-2 text-white/70 leading-relaxed">{t('note')}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
