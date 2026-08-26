'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle } from 'lucide-react';
import {
  Tooltip,
  inputClass,
  pillClass,
  emptyContactForm,
  submitInquiry,
  type ContactFormData,
} from './contact/shared';

export default function ContactForm() {
  const t = useTranslations('contact');
  const [form, setForm] = useState<ContactFormData>(emptyContactForm);
  const [website, setWebsite] = useState('');
  const [startedAt] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const set = (key: keyof ContactFormData, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggle = (key: keyof ContactFormData, value: string) =>
    set(key, form[key] === value ? '' : value);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const outcome = await submitInquiry({ ...form, website, startedAt });
    if (outcome.ok) {
      setSuccess(true);
    } else {
      setError(outcome.reason === 'rateLimited' ? t('formRateLimited') : t('formError'));
    }
    setLoading(false);
  }

  if (success) {
    return (
      <div className="rounded-3xl border border-green-100 bg-green-50 p-12 text-center">
        <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
        <h3 className="text-xl font-bold mb-2">{t('formSuccessTitle')}</h3>
        <p className="text-gray-600 max-w-sm mx-auto">{t('formSuccessMessage')}</p>
      </div>
    );
  }

  const services = [
    { label: t('formServiceWebsite'), value: 'website' },
    { label: t('formServiceSeo'), value: 'automation' },
    { label: t('formServiceAds'), value: 'saas' },
    { label: t('formServiceBranding'), value: 'branding' },
    { label: t('formServiceUnknown'), value: 'integration' },
  ];

  const budgets = [
    { label: t('formBudgetUnder1k'), value: 'under_1k' },
    { label: t('formBudget1k5k'), value: '1k_5k' },
    { label: t('formBudget5k15k'), value: '5k_15k' },
    { label: t('formBudgetAbove15k'), value: 'above_15k' },
    { label: t('formBudgetPreferNot'), value: 'prefer_not' },
  ];

  const times = [
    { label: t('formTimeMorning'), value: 'morning' },
    { label: t('formTimeAfternoon'), value: 'afternoon' },
    { label: t('formTimeEvening'), value: 'evening' },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-7">
      <div
        aria-hidden="true"
        className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden"
      >
        <label htmlFor="contact-website">Website</label>
        <input
          id="contact-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>
      {/* Name + Email */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-semibold mb-1.5">
            {t('formName')} <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            required
            maxLength={100}
            autoComplete="name"
            placeholder={t('formNamePlaceholder')}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1.5">
            {t('formEmail')} <span className="text-red-400">*</span>
          </label>
          <input
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            placeholder={t('formEmailPlaceholder')}
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {/* Company */}
      <div>
        <label className="block text-sm font-semibold mb-1.5">{t('formCompany')}</label>
        <input
          type="text"
          maxLength={120}
          autoComplete="organization"
          placeholder={t('formCompanyPlaceholder')}
          value={form.company}
          onChange={(e) => set('company', e.target.value)}
          className={inputClass}
        />
      </div>

      {/* Service */}
      <div>
        <label className="flex items-center text-sm font-semibold mb-3">
          {t('formService')}
          <Tooltip text={t('formServiceTooltip')} />
        </label>
        <div className="flex flex-wrap gap-2">
          {services.map(({ label, value }) => (
            <button
              key={value}
              type="button"
              onClick={() => toggle('service', value)}
              className={pillClass(form.service === value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Budget */}
      <div>
        <label className="flex items-center text-sm font-semibold mb-3">
          {t('formBudget')}
          <Tooltip text={t('formBudgetTooltip')} />
        </label>
        <div className="flex flex-wrap gap-2">
          {budgets.map(({ label, value }) => (
            <button
              key={value}
              type="button"
              onClick={() => toggle('budget', value)}
              className={pillClass(form.budget === value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Message */}
      <div>
        <label className="block text-sm font-semibold mb-1.5">{t('formMessage')}</label>
        <textarea
          rows={4}
          maxLength={4000}
          placeholder={t('formMessagePlaceholder')}
          value={form.message}
          onChange={(e) => set('message', e.target.value)}
          className={`${inputClass} resize-none`}
        />
      </div>

      {/* Preferred Time */}
      <div>
        <label className="flex items-center text-sm font-semibold mb-3">
          {t('formPreferredTime')}
          <Tooltip text={t('formPreferredTimeTooltip')} />
        </label>
        <div className="flex flex-wrap gap-2 mb-4">
          {times.map(({ label, value }) => (
            <button
              key={value}
              type="button"
              onClick={() => toggle('preferredTime', value)}
              className={pillClass(form.preferredTime === value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="block text-sm font-semibold mb-1.5">{t('formCountry')}</label>
        <input
          type="text"
          maxLength={80}
          autoComplete="country-name"
          placeholder={t('formCountryPlaceholder')}
          value={form.country}
          onChange={(e) => set('country', e.target.value)}
          className={inputClass}
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-brand-fill text-white font-semibold py-4 rounded-2xl hover:opacity-90 transition disabled:opacity-60"
      >
        {loading ? t('formSubmitting') : t('formSubmit')}
      </button>
    </form>
  );
}
