import { getTranslations } from 'next-intl/server';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ContactOptions from '@/components/contact/ContactOptions';
import ContactChannels from '@/components/contact/ContactChannels';
import { createCorePageMetadata } from '@/lib/seo';

type ContactPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Pick<ContactPageProps, 'params'>) {
  const { locale } = await params;
  return createCorePageMetadata(locale, 'contact');
}

export default async function ContactPage({ params, searchParams }: ContactPageProps) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const t = await getTranslations({ locale, namespace: 'contact' });
  const service = typeof query.service === 'string' ? query.service : '';
  const initialService = ['automation', 'saas', 'website', 'branding', 'integration'].includes(service) ? service : '';
  const context = query.context === 'growth' || query.context === 'strategy' ? query.context : '';
  const initialMessage = context === 'growth' ? t('growthPrompt') : context === 'strategy' ? t('strategyPrompt') : '';
  const initialContext = context === 'growth' ? t('growthContext') : context === 'strategy' ? t('strategyContext') : '';

  return (
    <>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-surface focus:outline-none">
      <section className="mx-auto max-w-3xl px-6 pb-20 pt-32 md:px-8" aria-labelledby="contact-heading">
        <div className="mb-8">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-primary">{t('label')}</p>
          <h1 id="contact-heading" className="mt-4 text-4xl font-bold leading-tight md:text-5xl">{t('heading')}</h1>
          <p className="mt-5 text-lg leading-relaxed text-gray-600">{t('description')}</p>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">{t('auditScope')}</p>
          <a href="#contact-channels" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4">{t('directContactLink')}</a>
        </div>

        <ContactOptions initialService={initialService} initialMessage={initialMessage} initialContext={initialContext} />

        <section aria-labelledby="contact-next-title" className="mt-8 rounded-xl border border-gray-200 p-6">
          <h2 id="contact-next-title" className="mb-4 text-lg font-bold">{t('nextTitle')}</h2>
          <ol className="space-y-3 text-sm leading-relaxed text-gray-600">
            {[t('nextReview'), t('nextScope'), t('nextPlan')].map((text, index) => (
              <li key={text} className="flex gap-3"><span className="font-semibold text-primary" aria-hidden="true">0{index + 1}</span><span>{text}</span></li>
            ))}
          </ol>
        </section>

        <ContactChannels />
      </section>
      </main>
      <Footer />
    </>
  );
}
