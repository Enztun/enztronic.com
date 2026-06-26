'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ClipboardList, ListChecks, ArrowLeft } from 'lucide-react';
import ContactForm from '@/components/ContactForm';
import ContactJourney from './ContactJourney';

type Mode = 'choose' | 'form' | 'journey';

export default function ContactOptions() {
  const t = useTranslations('contact');
  const [mode, setMode] = useState<Mode>('choose');

  if (mode === 'choose') {
    return (
      <div className="grid gap-6 md:grid-cols-2">
        <button
          type="button"
          onClick={() => setMode('form')}
          className="text-left rounded-3xl border border-gray-200 bg-gray-50 p-8 hover:border-primary/50 hover:shadow-md transition"
        >
          <ClipboardList className="w-8 h-8 text-primary mb-4" />
          <h3 className="text-lg font-bold mb-2">{t('optionFormTitle')}</h3>
          <p className="text-sm text-gray-600">{t('optionFormDescription')}</p>
        </button>
        <button
          type="button"
          onClick={() => setMode('journey')}
          className="text-left rounded-3xl border border-gray-200 bg-gray-50 p-8 hover:border-primary/50 hover:shadow-md transition"
        >
          <ListChecks className="w-8 h-8 text-primary mb-4" />
          <h3 className="text-lg font-bold mb-2">{t('optionJourneyTitle')}</h3>
          <p className="text-sm text-gray-600">{t('optionJourneyDescription')}</p>
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-gray-200 bg-gray-50 p-8 md:p-10">
      <button
        type="button"
        onClick={() => setMode('choose')}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-primary mb-6 transition"
      >
        <ArrowLeft className="w-4 h-4" />
        {t('journeyChangeMethod')}
      </button>
      {mode === 'form' ? <ContactForm /> : <ContactJourney />}
    </div>
  );
}
