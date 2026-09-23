'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { MessageCircle, X, Send, CheckCircle, Loader2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { trackEvent } from '@/lib/analytics';
import { MAX_CHAT_MESSAGES, MAX_CHAT_MESSAGE_CHARS, MAX_CHAT_BODY_BYTES } from '@/lib/chat-limits';

/**
 * The site chat launcher and panel.
 *
 * The inquiry card is the point of the whole thing: the agent proposes an
 * inquiry, the visitor reads it and taps send. Nothing reaches Sanity until
 * they do, which is why the agent itself has no write access.
 */

type ChatMessage = { role: 'user' | 'assistant'; content: string };

type InquiryDraft = {
  name: string;
  email: string;
  company?: string;
  service?: string;
  budget?: string;
  message?: string;
  preferredTime?: string;
  country?: string;
};

type CardState = 'pending' | 'sending' | 'sent' | 'error';

const MAX_INPUT_CHARS = MAX_CHAT_MESSAGE_CHARS;

export default function ChatWidget() {
  const t = useTranslations('chat');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inquiry, setInquiry] = useState<InquiryDraft | null>(null);
  const [cardState, setCardState] = useState<CardState>('pending');
  const [inquiryRevision, setInquiryRevision] = useState(0);
  const [bodyLimit, setBodyLimit] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const atLimit = messages.length >= MAX_CHAT_MESSAGES || bodyLimit;

  function closeChat() {
    setOpen(false);
    launcherRef.current?.focus();
  }

  function restart() {
    setMessages([]);
    setError('');
    setBodyLimit(false);
    inputRef.current?.focus();
    trackEvent('chat_restart', { locale });
  }

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reduced ? 'instant' : 'smooth' });
  }, [messages, loading, inquiry]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Escape closes the panel, matching the tooltip and menu behaviour elsewhere.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        launcherRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading || atLimit || cardState === 'sending') return;

    const next = [...messages, { role: 'user' as const, content: text }];
    const body = JSON.stringify({ messages: next, locale });
    if (new TextEncoder().encode(body).byteLength > MAX_CHAT_BODY_BYTES) {
      setBodyLimit(true);
      return;
    }
    setMessages(next);
    setInput('');
    setLoading(true);
    setError('');
    inputRef.current?.focus();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(45_000),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(res.status === 429 ? t('errorBusy') : t('error'));
        setMessages(messages);
        setInput(text);
        trackEvent('chat_error', { reason: String(res.status), locale });
        return;
      }
      if (!data.reply && !data.inquiry) throw new Error('Empty response');
      if (data.reply) {
        setMessages([...next, { role: 'assistant', content: data.reply }]);
      }
      if (data.inquiry) {
        setInquiry(data.inquiry as InquiryDraft);
        setCardState('pending');
        setInquiryRevision((n) => n + 1);
      }
      trackEvent('chat_reply', { locale });
    } catch {
      setError(t('error'));
      setMessages(messages);
      setInput(text);
    } finally {
      setLoading(false);
    }
  }

  async function confirmInquiry(draft: InquiryDraft) {
    if (loading || cardState === 'sending' || cardState === 'sent') return;
    setCardState('sending');
    try {
      const res = await fetch('/api/chat/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
        signal: AbortSignal.timeout(20_000),
      });
      setCardState(res.ok ? 'sent' : 'error');
      trackEvent(res.ok ? 'chat_inquiry_success' : 'chat_inquiry_error', { locale });
    } catch {
      setCardState('error');
    }
  }

  const greeting = messages.length === 0;

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        onClick={() => {
          if (open) closeChat();
          else { setOpen(true); trackEvent('chat_open', { locale }); }
        }}
        aria-label={open ? t('close') : t('launcher')}
        aria-expanded={open}
        aria-controls="site-chat"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-fill text-white shadow-lg transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>

      {open && (
        <div
          id="site-chat"
          role="dialog"
          aria-label={t('title')}
          className="ui-enter fixed bottom-24 right-4 z-40 flex h-[36rem] max-h-[calc(100dvh-8rem)] w-[calc(100%-2rem)] max-w-sm flex-col overflow-hidden rounded-3xl border border-gray-200 bg-card shadow-2xl"
        >
          <header className="border-b border-gray-100 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-bold">{t('title')}</h2>
              <button type="button" onClick={closeChat} aria-label={t('close')} className="rounded-lg p-2 hover:bg-gray-100"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-xs text-gray-400">{t('disclaimer')}</p>
            {messages.length > 0 && <button type="button" disabled={loading || cardState === 'sending'} onClick={restart} className="mt-2 text-sm font-semibold text-primary disabled:opacity-50">{t('restart')}</button>}
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4">
            {greeting && <p className="text-base leading-relaxed text-gray-500">{t('greeting')}</p>}

            <div role="log" aria-label={t('history')} aria-live="polite" aria-relevant="additions text" className="space-y-3">
            {messages.map((message, i) => (
              <div
                key={i}
                className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <p
                  className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-base leading-relaxed ${
                    message.role === 'user'
                      ? 'bg-brand-fill text-white'
                      : 'bg-gray-50 text-gray-700'
                  }`}
                >
                  {message.content}
                </p>
              </div>
            ))}
            </div>

            {loading && (
              <div className="flex justify-start">
                <span role="status" className="flex items-center gap-2 rounded-2xl bg-gray-50 px-4 py-2.5 text-sm text-gray-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('thinking')}
                </span>
              </div>
            )}

            {inquiry && <InquiryCard key={inquiryRevision} draft={inquiry} state={cardState} busy={loading} onSend={confirmInquiry} onCancel={() => setInquiry(null)} />}

            {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
            {atLimit && <div role="status" className="space-y-2 rounded-xl bg-gray-50 p-3 text-sm">
              <p>{t('limit')}</p>
              <button type="button" onClick={restart} disabled={loading} className="font-semibold text-primary">{t('restart')}</button>
            </div>}
            <Link href="/contact" onClick={closeChat} className="inline-block text-sm font-semibold text-primary">{t('contactAlternative')}</Link>
          </div>

          <form onSubmit={send} className="flex items-center gap-2 border-t border-gray-100 p-3">
            <input
              ref={inputRef}
              type="text"
              value={input}
              maxLength={MAX_INPUT_CHARS}
              readOnly={loading || cardState === 'sending'}
              disabled={atLimit}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('placeholder')}
              aria-label={t('placeholder')}
              className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-card px-4 py-2.5 text-base focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={loading || atLimit || cardState === 'sending' || input.trim() === ''}
              aria-label={t('send')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-fill text-white transition hover:opacity-90 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function InquiryCard({
  draft,
  state,
  busy,
  onSend,
  onCancel,
}: {
  draft: InquiryDraft;
  state: CardState;
  busy: boolean;
  onSend: (draft: InquiryDraft) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('chat');
  const c = useTranslations('contact');
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(draft);
  const serviceLabels: Record<string, string> = {
    website: c('formServiceWebsite'), automation: c('formServiceSeo'), saas: c('formServiceAds'),
    branding: c('formServiceBranding'), integration: t('integration'),
  };
  const budgetLabels: Record<string, string> = {
    under_1k: c('formBudgetUnder1k'), '1k_5k': c('formBudget1k5k'), '5k_15k': c('formBudget5k15k'),
    above_15k: c('formBudgetAbove15k'), prefer_not: c('formBudgetPreferNot'),
  };
  const timeLabels: Record<string, string> = {
    morning: c('formTimeMorning'), afternoon: c('formTimeAfternoon'), evening: c('formTimeEvening'),
  };
  const fields: { key: keyof InquiryDraft; label: string; max: number; choices?: Record<string, string> }[] = [
    { key: 'name', label: t('cardName'), max: 100 },
    { key: 'email', label: t('cardEmail'), max: 254 },
    { key: 'company', label: t('cardCompany'), max: 120 },
    { key: 'service', label: t('cardService'), max: 40, choices: serviceLabels },
    { key: 'budget', label: t('cardBudget'), max: 40, choices: budgetLabels },
    { key: 'preferredTime', label: t('cardTime'), max: 40, choices: timeLabels },
    { key: 'country', label: t('cardCountry'), max: 80 },
    { key: 'message', label: t('cardMessage'), max: 4000 },
  ];

  if (state === 'sent') {
    return (
      <div role="status" className="rounded-2xl border border-line bg-gray-50 p-4 text-center">
        <CheckCircle className="mx-auto mb-2 h-6 w-6 text-green-500" />
        <p className="text-sm font-semibold">{t('cardSent')}</p>
      </div>
    );
  }

  if (editing) return (
    <form className="ui-enter space-y-3 rounded-2xl border border-line bg-gray-50 p-4" onSubmit={(e) => { e.preventDefault(); setEditing(false); }}>
      <h3 className="text-base font-semibold">{t('edit')}</h3>
      {fields.map(({ key, label, max, choices }) => <label key={key} className="block text-sm font-semibold">
        {label}{(key === 'name' || key === 'email') && ' *'}
        {choices ? <select value={edited[key] ?? ''} onChange={(e) => setEdited({ ...edited, [key]: e.target.value })} className="mt-1 block w-full rounded-lg border border-line bg-card px-3 py-2 text-base">
          <option value="">{t('notSpecified')}</option>
          {Object.entries(choices).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select> : key === 'message' ? <textarea rows={3} value={edited[key] ?? ''} maxLength={max} onChange={(e) => setEdited({ ...edited, [key]: e.target.value })} className="mt-1 block w-full rounded-lg border border-line bg-card px-3 py-2 text-base" />
          : <input type={key === 'email' ? 'email' : 'text'} required={key === 'name' || key === 'email'} minLength={key === 'name' ? 2 : undefined} maxLength={max} value={edited[key] ?? ''} onChange={(e) => setEdited({ ...edited, [key]: e.target.value })} className="mt-1 block w-full rounded-lg border border-line bg-card px-3 py-2 text-base" />}
      </label>)}
      <button className="w-full rounded-xl bg-brand-fill px-4 py-3 text-sm font-semibold text-white" type="submit">{t('save')}</button>
    </form>
  );

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
      <p className="mb-3 text-sm font-bold">{t('cardTitle')}</p>
      <dl className="mb-4 space-y-1.5">
        {fields
          .filter(({ key }) => Boolean(edited[key]))
          .map(({ key, label, choices }) => (
            <div key={key} className="text-sm">
              <dt className="font-semibold text-gray-500">{label}</dt>
              <dd className="break-words whitespace-pre-wrap text-gray-700">{choices?.[edited[key] ?? ''] ?? edited[key]}</dd>
            </div>
          ))}
      </dl>
      <div className="mb-3 flex gap-4 text-sm font-semibold text-primary">
        <button type="button" disabled={busy || state === 'sending'} onClick={() => setEditing(true)}>{t('edit')}</button>
        <button type="button" disabled={busy || state === 'sending'} onClick={onCancel}>{t('cancel')}</button>
      </div>
      {state === 'error' && <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-300">{t('cardError')}</p>}
      <button
        type="button"
        onClick={() => onSend(edited)}
        disabled={busy || state === 'sending'}
        className="w-full rounded-xl bg-brand-fill py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {state === 'sending' ? t('cardSending') : t('cardSend')}
      </button>
    </div>
  );
}
