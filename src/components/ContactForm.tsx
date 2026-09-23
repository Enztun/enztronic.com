'use client';

import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import { IdentityFields, OptionalFields, ProblemField } from './contact/ContactFields';
import { primaryButtonClass, type ContactFieldsProps } from './contact/shared';

export default function ContactForm({ form, onChange, errors, detailsOpen, onDetailsToggle, loading }: ContactFieldsProps & {
  detailsOpen: boolean;
  onDetailsToggle: () => void;
  loading: boolean;
}) {
  const t = useTranslations('contact');
  const fieldProps = { form, onChange, errors };
  return (
    <div className="space-y-7">
      <div>
        <h2 id="contact-form-title" tabIndex={-1} className="text-xl font-bold focus:outline-none">{t('shortFormTitle')}</h2>
        <p className="mt-2 text-sm text-gray-600">{t('requiredHint')}</p>
      </div>
      <ProblemField {...fieldProps} />
      <IdentityFields {...fieldProps} />
      <div className="rounded-xl border border-gray-200">
        <button type="button" aria-expanded={detailsOpen} aria-controls="contact-optional-details"
          onClick={onDetailsToggle} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold text-gray-700 focus-visible:outline-2 focus-visible:outline-primary">
          {t('optionalDetails')} <ChevronDown aria-hidden="true" className={`h-5 w-5 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${detailsOpen ? 'rotate-180' : ''}`} />
        </button>
        <div id="contact-optional-details" hidden={!detailsOpen} className="border-t border-gray-200 p-4 sm:p-5">
          <OptionalFields {...fieldProps} />
        </div>
      </div>
      <p className="text-sm leading-relaxed text-gray-600">{t('dataUseNote')}</p>
      <button type="submit" className={`${primaryButtonClass} w-full sm:w-auto`} disabled={loading}>
        {loading ? t('formSubmitting') : t('formSubmit')}
      </button>
    </div>
  );
}
