'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export function RetryButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const t = useTranslations('blogUx');
  return (
    <button type="button" onClick={() => startTransition(() => router.refresh())} disabled={pending}
      aria-busy={pending} className="rounded-full bg-brand-fill px-6 py-3 font-semibold text-white transition-colors hover:bg-brand-fill-strong disabled:opacity-60">
      {pending ? t('retrying') : t('retry')}
    </button>
  );
}
