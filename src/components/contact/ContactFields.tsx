'use client';

import { useTranslations } from 'next-intl';
import { inputClass, type ContactFieldsProps, type ContactFormData } from './shared';

function FieldError({ name, error }: { name: string; error?: string }) {
  return error ? <p id={`contact-${name}-error`} className="mt-2 text-sm text-red-600 dark:text-red-300">{error}</p> : null;
}

export function ProblemField({ form, onChange, errors }: ContactFieldsProps) {
  const t = useTranslations('contact');
  return (
    <div>
      <label htmlFor="contact-message" className="mb-2 block font-semibold">{t('formMessage')} <span aria-hidden="true">*</span></label>
      <p id="contact-message-help" className="mb-3 text-sm leading-relaxed text-gray-600">{t('problemHint')}</p>
      <textarea id="contact-message" name="message" required maxLength={4000} rows={4}
        placeholder={t('formMessagePlaceholder')} value={form.message}
        onChange={(event) => onChange('message', event.target.value)}
        aria-invalid={Boolean(errors.message)}
        aria-describedby={`contact-message-help${errors.message ? ' contact-message-error' : ''}`}
        className={`${inputClass} resize-y`} />
      <FieldError name="message" error={errors.message} />
    </div>
  );
}

export function IdentityFields({ form, onChange, errors }: ContactFieldsProps) {
  const t = useTranslations('contact');
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div>
        <label htmlFor="contact-name" className="mb-2 block text-sm font-semibold">{t('formName')} <span aria-hidden="true">*</span></label>
        <input id="contact-name" name="name" type="text" required minLength={2} maxLength={100}
          autoComplete="name" placeholder={t('formNamePlaceholder')} value={form.name}
          onChange={(event) => onChange('name', event.target.value)} aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'contact-name-error' : undefined} className={inputClass} />
        <FieldError name="name" error={errors.name} />
      </div>
      <div>
        <label htmlFor="contact-email" className="mb-2 block text-sm font-semibold">{t('formEmail')} <span aria-hidden="true">*</span></label>
        <input id="contact-email" name="email" type="email" inputMode="email" required maxLength={254}
          autoComplete="email" placeholder={t('formEmailPlaceholder')} value={form.email}
          onChange={(event) => onChange('email', event.target.value)} aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'contact-email-error' : undefined} className={inputClass} />
        <FieldError name="email" error={errors.email} />
      </div>
    </div>
  );
}

function Choices({ name, label, hint, value, options, onChange }: {
  name: string;
  label: string;
  hint?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <fieldset aria-describedby={hint ? `contact-${name}-hint` : undefined}>
      <legend className="mb-2 text-sm font-semibold">{label}</legend>
      {hint && <p id={`contact-${name}-hint`} className="mb-3 text-sm leading-relaxed text-gray-600">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className="relative cursor-pointer">
            <input type="radio" name={name} value={option.value} checked={value === option.value}
              onChange={() => onChange(option.value)} className="peer sr-only" />
            <span className="inline-flex min-h-11 items-center rounded-xl border border-gray-300 bg-card px-4 py-2 text-sm font-medium text-gray-700 transition-colors peer-checked:border-primary peer-checked:bg-brand-fill peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary hover:border-primary">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function OptionalFields({ form, onChange }: ContactFieldsProps) {
  const t = useTranslations('contact');
  return (
    <div className="space-y-7">
      <Choices name="service" label={t('formService')} hint={t('serviceHint')} value={form.service}
        onChange={(value) => onChange('service', value)} options={[
          { value: '', label: t('formServiceUnknown') },
          { value: 'automation', label: t('formServiceSeo') },
          { value: 'saas', label: t('formServiceAds') },
          { value: 'website', label: t('formServiceWebsite') },
          { value: 'branding', label: t('formServiceBranding') },
          { value: 'integration', label: t('formServiceIntegration') },
        ]} />
      <Choices name="budget" label={t('formBudget')} hint={t('budgetHint')} value={form.budget}
        onChange={(value) => onChange('budget', value)} options={[
          { value: '', label: t('noPreference') },
          { value: 'under_1k', label: t('formBudgetUnder1k') },
          { value: '1k_5k', label: t('formBudget1k5k') },
          { value: '5k_15k', label: t('formBudget5k15k') },
          { value: 'above_15k', label: t('formBudgetAbove15k') },
          { value: 'prefer_not', label: t('formBudgetPreferNot') },
        ]} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-company" className="mb-2 block text-sm font-semibold">{t('formCompany')}</label>
          <input id="contact-company" name="company" type="text" maxLength={120} autoComplete="organization"
            placeholder={t('formCompanyPlaceholder')} value={form.company}
            onChange={(event) => onChange('company', event.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="contact-country" className="mb-2 block text-sm font-semibold">{t('formCountry')}</label>
          <input id="contact-country" name="country" type="text" maxLength={80} autoComplete="country-name"
            placeholder={t('formCountryPlaceholder')} value={form.country}
            onChange={(event) => onChange('country', event.target.value)} className={inputClass} />
        </div>
      </div>
      <Choices name="preferredTime" label={t('formPreferredTime')} hint={t('timezoneHint')}
        value={form.preferredTime} onChange={(value) => onChange('preferredTime', value)} options={[
          { value: '', label: t('noPreference') },
          { value: 'morning', label: t('formTimeMorning') },
          { value: 'afternoon', label: t('formTimeAfternoon') },
          { value: 'evening', label: t('formTimeEvening') },
        ]} />
    </div>
  );
}

export function ContactReview({ form }: { form: ContactFormData }) {
  const t = useTranslations('contact');
  const serviceLabels: Record<string, string> = { automation: t('formServiceSeo'), saas: t('formServiceAds'), website: t('formServiceWebsite'), branding: t('formServiceBranding'), integration: t('formServiceIntegration') };
  const budgetLabels: Record<string, string> = { under_1k: t('formBudgetUnder1k'), '1k_5k': t('formBudget1k5k'), '5k_15k': t('formBudget5k15k'), above_15k: t('formBudgetAbove15k'), prefer_not: t('formBudgetPreferNot') };
  const timeLabels: Record<string, string> = { morning: t('formTimeMorning'), afternoon: t('formTimeAfternoon'), evening: t('formTimeEvening') };
  const rows = [
    [t('formMessage'), form.message], [t('formName'), form.name], [t('formEmail'), form.email],
    [t('formCompany'), form.company], [t('formCountry'), form.country],
    [t('formService'), serviceLabels[form.service]], [t('formBudget'), budgetLabels[form.budget]],
    [t('formPreferredTime'), timeLabels[form.preferredTime]],
  ];
  return (
    <dl className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-card px-5">
      {rows.filter(([, value]) => Boolean(value?.trim())).map(([label, value]) => (
        <div key={label} className="py-4">
          <dt className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
          <dd className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
