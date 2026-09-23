'use client';

export type ContactFormData = {
  name: string;
  email: string;
  company: string;
  service: string;
  budget: string;
  message: string;
  preferredTime: string;
  country: string;
};

export type RequiredContactField = 'message' | 'name' | 'email';
export type ContactErrors = Partial<Record<RequiredContactField, string>>;
export type ContactFieldsProps = {
  form: ContactFormData;
  onChange: (key: keyof ContactFormData, value: string) => void;
  errors: ContactErrors;
};

export const emptyContactForm: ContactFormData = {
  name: '', email: '', company: '', service: '', budget: '', message: '', preferredTime: '', country: '',
};

export function contactValidation(form: ContactFormData) {
  const errors: Partial<Record<RequiredContactField, 'validationMessage' | 'validationName' | 'validationEmail'>> = {};
  if (!form.message.trim()) errors.message = 'validationMessage';
  if (form.name.trim().length < 2) errors.name = 'validationName';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'validationEmail';
  return errors;
}

/** The same transport and anti-spam payload serve both contact interfaces. */
export type SubmitOutcome = { ok: true } | { ok: false; reason: 'rateLimited' | 'error' };

export async function submitInquiry(
  payload: ContactFormData & { website: string; startedAt: number }
): Promise<SubmitOutcome> {
  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status === 429) return { ok: false, reason: 'rateLimited' };
    if (!res.ok) return { ok: false, reason: 'error' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export const inputClass =
  'w-full min-w-0 rounded-xl border border-gray-300 bg-card px-4 py-3 text-base text-gray-900 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-invalid:border-red-500';

export const primaryButtonClass =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-fill px-6 py-3 font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60';

export const secondaryButtonClass =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function focusContactField(field: RequiredContactField) {
  requestAnimationFrame(() => document.getElementById(`contact-${field}`)?.focus());
}
