'use client';

import { useTranslations } from 'next-intl';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Link } from '@/i18n/navigation';

export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('navigationUx');
  return (
    <>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl px-6 pt-36 pb-24">
        <h1 className="mb-5 text-3xl md:text-5xl">{t('errorTitle')}</h1>
        <p role="alert" className="mb-8 text-lg text-on-surface-variant">{t('errorBody')}</p>
        <div className="flex flex-wrap gap-4">
          <button type="button" onClick={reset} className="rounded-full bg-brand-fill px-6 py-3 font-semibold text-white">{t('tryAgain')}</button>
          <Link href="/" className="rounded-full border border-line px-6 py-3 font-semibold text-brand">{t('backHome')}</Link>
          <Link href="/contact" className="rounded-full px-6 py-3 font-semibold text-brand">{t('contactUs')}</Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
