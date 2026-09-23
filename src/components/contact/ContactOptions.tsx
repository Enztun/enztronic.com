'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle } from 'lucide-react';
import ContactForm from '@/components/ContactForm';
import { trackEvent } from '@/lib/analytics';
import ContactJourney from './ContactJourney';
import styles from './ContactFlow.module.css';
import {
  contactValidation, emptyContactForm, focusContactField, submitInquiry,
  type ContactErrors, type ContactFormData, type RequiredContactField,
} from './shared';

type Mode = 'form' | 'journey';

function focusTitle() {
  requestAnimationFrame(() => document.getElementById('contact-form-title')?.focus());
}

function SuccessMessage() {
  const t = useTranslations('contact');
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div role="status" className="rounded-2xl border border-primary/30 bg-card px-6 py-10 text-center">
      <CheckCircle aria-hidden="true" className="mx-auto mb-4 h-10 w-10 text-primary" />
      <h2 ref={ref} tabIndex={-1} className="mb-3 text-2xl font-bold focus:outline-none">{t('formSuccessTitle')}</h2>
      <p className="mx-auto max-w-md leading-relaxed text-gray-600">{t('formSuccessMessage')}</p>
    </div>
  );
}

/** Owns the draft and submission so changing presentation never discards work. */
export default function ContactOptions({ initialService = '', initialMessage = '', initialContext = '' }: {
  initialService?: string;
  initialMessage?: string;
  initialContext?: string;
}) {
  const t = useTranslations('contact');
  const [mode, setMode] = useState<Mode>('form');
  const [form, setForm] = useState<ContactFormData>(() => ({ ...emptyContactForm, service: initialService, message: initialMessage }));
  const [context] = useState(initialContext);
  const [detailsOpen, setDetailsOpen] = useState(Boolean(initialService));
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [website, setWebsite] = useState('');
  const [startedAt] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const submittingRef = useRef(false);
  const startedRef = useRef(false);

  function onChange(key: keyof ContactFormData, value: string) {
    if (!startedRef.current) {
      trackEvent('contact_start', { mode, service: form.service || 'unknown' });
      startedRef.current = true;
    }
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
    setSubmitError('');
  }

  function changeMode(next: Mode) {
    if (mode === next) return;
    setMode(next);
    trackEvent('contact_method_change', { mode: next });
    focusTitle();
  }

  function changeStep(next: number) {
    setStep(next);
    trackEvent('contact_step_view', { mode: 'journey', step: next });
    focusTitle();
  }

  function validate(fields: RequiredContactField[]) {
    const results = contactValidation(form);
    const selectedErrors: ContactErrors = {};
    for (const field of fields) {
      const key = results[field];
      if (key) selectedErrors[field] = t(key);
    }
    setErrors((previous) => ({ ...previous, ...Object.fromEntries(fields.map((field) => [field, selectedErrors[field]])) }));
    const first = fields.find((field) => selectedErrors[field]);
    if (first) {
      if (mode === 'journey') setStep(first === 'message' ? 1 : 3);
      focusContactField(first);
      trackEvent('contact_error', { mode, reason: 'validation' });
      return false;
    }
    return true;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    // Enter in a guided field advances to review rather than sending early.
    if (mode === 'journey' && step < 4) {
      const fields: RequiredContactField[] = step === 1 ? ['message'] : step === 3 ? ['name', 'email'] : [];
      if (validate(fields)) changeStep(step + 1);
      return;
    }
    if (!validate(['message', 'name', 'email'])) return;
    submittingRef.current = true;
    setLoading(true);
    setSubmitError('');
    trackEvent('contact_submit', { mode, service: form.service || 'unknown' });
    const outcome = await submitInquiry({ ...form, website, startedAt });
    if (outcome.ok) {
      setSuccess(true);
      trackEvent('contact_success', { mode, service: form.service || 'unknown' });
    } else {
      setSubmitError(outcome.reason === 'rateLimited' ? t('formRateLimited') : t('formError'));
      trackEvent('contact_error', { mode, reason: outcome.reason === 'rateLimited' ? 'rate_limited' : 'submission' });
      requestAnimationFrame(() => document.getElementById('contact-submit-error')?.focus());
    }
    setLoading(false);
    submittingRef.current = false;
  }

  if (success) return <SuccessMessage />;

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 sm:p-8">
      <div className="mb-7 flex flex-wrap gap-2" role="group" aria-label={t('methodLabel')}>
        {(['form', 'journey'] as const).map((value) => (
          <button key={value} type="button" aria-pressed={mode === value} disabled={loading}
            onClick={() => changeMode(value)}
            className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${mode === value ? 'border-primary bg-brand-fill text-white' : 'border-gray-300 bg-card text-gray-700 hover:border-primary'}`}>
            {value === 'form' ? t('optionFormTitle') : t('optionJourneyTitle')}
          </button>
        ))}
      </div>
      {context && <p className="mb-5 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-gray-700">{context}</p>}
      <form onSubmit={handleSubmit} noValidate aria-busy={loading}>
        <div aria-hidden="true" className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden">
          <label htmlFor="contact-website">Website</label>
          <input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off"
            value={website} onChange={(event) => setWebsite(event.target.value)} />
        </div>
        <fieldset key={`${mode}-${step}`} disabled={loading} className={`min-w-0 ${styles.flow}`}>
          <legend className="sr-only">{t('shortFormTitle')}</legend>
          {mode === 'form' ? (
            <ContactForm form={form} onChange={onChange} errors={errors} loading={loading} detailsOpen={detailsOpen}
              onDetailsToggle={() => {
                setDetailsOpen(!detailsOpen);
                trackEvent('contact_details_toggle', { mode, expanded: !detailsOpen });
              }} />
          ) : (
            <ContactJourney form={form} onChange={onChange} errors={errors} loading={loading}
              step={step} onStepChange={changeStep} />
          )}
        </fieldset>
        <div className="mt-4" aria-live="polite" aria-atomic="true">
          {loading && <p className="text-sm text-gray-600">{t('formSubmitting')}</p>}
          {submitError && (
            <div id="contact-submit-error" role="alert" tabIndex={-1} className="rounded-xl border border-red-300 p-4 text-sm text-red-600 dark:text-red-300">
              <p>{submitError}</p>
              <a href={`mailto:${t('email')}`} onClick={() => trackEvent('contact_channel_click', { method: 'email', source: 'error' })}
                className="mt-2 inline-flex min-h-11 items-center break-all font-semibold underline underline-offset-4">{t('email')}</a>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
