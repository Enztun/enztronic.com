import { getTranslations } from 'next-intl/server';

export default async function Loading() {
  const t = await getTranslations('navigationUx');
  return (
    <main id="main-content" tabIndex={-1} aria-busy="true" className="mx-auto w-full max-w-5xl px-6 pt-36 pb-24">
      <p role="status" className="mb-8 text-lg text-on-surface-variant">{t('loading')}</p>
      <div aria-hidden="true" className="space-y-6">
        <div className="h-12 w-3/4 rounded-lg bg-surface-muted" />
        <div className="h-6 w-full rounded-lg bg-surface-muted" />
        <div className="h-6 w-2/3 rounded-lg bg-surface-muted" />
        <div className="mt-12 h-64 rounded-2xl bg-surface-muted" />
      </div>
    </main>
  );
}
