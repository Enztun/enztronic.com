'use client';

import { useTranslations } from 'next-intl';
import { Mail, MapPin, MessageCircle } from 'lucide-react';
import { trackEvent } from '@/lib/analytics';

export default function ContactChannels() {
  const t = useTranslations('contact');
  return (
    <section id="contact-channels" aria-labelledby="contact-channels-title" className="mt-10 scroll-mt-28">
      <h2 id="contact-channels-title" className="mb-4 text-lg font-bold">{t('directContactTitle')}</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <a href={`mailto:${t('email')}`} onClick={() => trackEvent('contact_channel_click', { method: 'email', source: 'contact' })}
          className="rounded-xl border border-gray-200 bg-card p-5 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-primary">
          <Mail aria-hidden="true" className="mb-3 h-5 w-5 text-primary" />
          <span className="mb-2 block text-sm font-semibold">{t('emailLabel')}</span>
          <span className="break-all text-sm text-primary underline underline-offset-4">{t('email')}</span>
        </a>
        <a href={`https://wa.me/${t('phoneNumber').replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
          onClick={() => trackEvent('contact_channel_click', { method: 'whatsapp', source: 'contact' })}
          className="rounded-xl border border-gray-200 bg-card p-5 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-primary">
          <MessageCircle aria-hidden="true" className="mb-3 h-5 w-5 text-primary" />
          <span className="mb-2 block text-sm font-semibold">{t('phone')}<span className="sr-only"> — {t('opensNewTab')}</span></span>
          <span className="text-sm text-primary underline underline-offset-4">{t('phoneNumber')}</span>
        </a>
        <div className="rounded-xl border border-gray-200 bg-card p-5">
          <MapPin aria-hidden="true" className="mb-3 h-5 w-5 text-primary" />
          <span className="mb-2 block text-sm font-semibold">{t('office')}</span>
          <span className="text-sm text-gray-600">{t('officeLocation')}</span>
        </div>
      </div>
    </section>
  );
}
