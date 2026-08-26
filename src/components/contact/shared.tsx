'use client';

import { useState, useRef, useEffect } from 'react';
import { Info } from 'lucide-react';

export function Tooltip({ text }: { text: string }) {
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
        <span className="absolute left-0 top-6 z-20 w-72 bg-gray-900 dark:bg-line text-white text-xs rounded-xl p-3 leading-relaxed shadow-xl">
          {text}
        </span>
      )}
    </span>
  );
}

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

export const emptyContactForm: ContactFormData = {
  name: '',
  email: '',
  company: '',
  service: '',
  budget: '',
  message: '',
  preferredTime: '',
  country: '',
};

/**
 * Both contact surfaces post the same payload, so the transport lives here to
 * keep the two in step. `rateLimited` is split out from `error` because the
 * advice differs: the generic failure tells people to email instead, which is
 * the wrong thing to say to someone who only needs to wait a minute.
 */
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
  'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition bg-card';

export const pillClass = (active: boolean) =>
  `px-4 py-2 rounded-full text-sm font-medium border transition-all cursor-pointer ${
    active
      ? 'bg-brand-fill text-white border-primary'
      : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-primary/50'
  }`;
