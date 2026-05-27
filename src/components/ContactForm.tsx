'use client';

import { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Info, CheckCircle } from 'lucide-react';

function Tooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex items-center ml-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-gray-400 hover:text-primary transition-colors"
        aria-label="More info"
      >
        <Info className="w-4 h-4" />
      </button>
      {open && (
        <span className="absolute left-0 top-6 z-20 w-72 bg-gray-900 text-white text-xs rounded-xl p-3 leading-relaxed shadow-xl">
          {text}
        </span>
      )}
    </span>
  );
}

type FormData = {
  name: string;
  email: string;
  company: string;
  service: string;
  budget: string;
  message: string;
  preferredTime: string;
  country: string;
};

const inputClass =
  'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition bg-white';

const pillClass = (active: boolean) =>
  `px-4 py-2 rounded-full text-sm font-medium border transition-all cursor-pointer ${
    active
      ? 'bg-primary text-white border-primary'
      : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-primary/50'
  }`;

export default function ContactForm() {
  const t = useTranslations('contact');
  const [form, setForm] = useState<FormData>({
    name: '',
    email: '',
    company: '',
    service: '',
    budget: '',
    message: '',
    preferredTime: '',
    country: '',
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const set = (key: keyof FormData, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggle = (key: keyof FormData, value: string) =>
    set(key, form[key] === value ? '' : value);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      setSuccess(true);
    } catch {
      setError(t('formError'));
    } finally {
      setLoading(false);
    }
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
    { label: t('formServiceSeo'), value: 'seo' },
    { label: t('formServiceAds'), value: 'ads' },
    { label: t('formServiceBranding'), value: 'branding' },
    { label: t('formServiceUnknown'), value: 'unknown' },
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
      {/* Name + Email */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-semibold mb-1.5">
            {t('formName')} <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            required
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
        className="w-full bg-primary text-white font-semibold py-4 rounded-2xl hover:opacity-90 transition disabled:opacity-60"
      >
        {loading ? t('formSubmitting') : t('formSubmit')}
      </button>
    </form>
  );
}
