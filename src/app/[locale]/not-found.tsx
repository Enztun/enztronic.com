import { getTranslations } from 'next-intl/server';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Link } from '@/i18n/navigation';

export default async function NotFound() {
  const t = await getTranslations('navigationUx');
  return (
    <>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl px-6 pt-36 pb-24">
        <p className="mb-4 font-semibold text-brand">404</p>
        <h1 className="mb-5 text-3xl md:text-5xl">{t('notFoundTitle')}</h1>
        <p className="mb-8 text-lg text-on-surface-variant">{t('notFoundBody')}</p>
        <div className="flex flex-wrap gap-4">
          <Link href="/" className="rounded-full bg-brand-fill px-6 py-3 font-semibold text-white">{t('backHome')}</Link>
          <Link href="/blog" className="rounded-full border border-line px-6 py-3 font-semibold text-brand">{t('browseInsights')}</Link>
          <Link href="/contact" className="rounded-full px-6 py-3 font-semibold text-brand">{t('contactUs')}</Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
