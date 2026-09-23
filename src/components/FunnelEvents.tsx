'use client';

import { useEffect } from 'react';
import { useLocale } from 'next-intl';
import { trackEvent } from '@/lib/analytics';

/** Delegated link measurement also covers server-rendered and CMS sections. */
export default function FunnelEvents() {
  const locale = useLocale();
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a');
      if (!link) return;
      const url = new URL(link.href, window.location.origin);
      const method = url.hostname === 'wa.me' ? 'whatsapp' : url.protocol === 'mailto:' ? 'email'
        : url.origin === window.location.origin && /\/(contact)\/?$/.test(url.pathname) ? 'form' : null;
      if (method) trackEvent('contact_link', { method, locale });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [locale]);
  return null;
}
