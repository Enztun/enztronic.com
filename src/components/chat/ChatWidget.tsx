'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { MessageCircle, X, Send, CheckCircle, Loader2 } from 'lucide-react';

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

const MAX_INPUT_CHARS = 2_000;

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading, inquiry]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Escape closes the panel, matching the tooltip and menu behaviour elsewhere.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, locale }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(res.status === 429 ? t('errorBusy') : t('error'));
        return;
      }
      if (data.reply) {
        setMessages([...next, { role: 'assistant', content: data.reply }]);
      }
      if (data.inquiry) {
        setInquiry(data.inquiry as InquiryDraft);
        setCardState('pending');
      }
    } catch {
      setError(t('error'));
    } finally {
      setLoading(false);
    }
  }

  async function confirmInquiry() {
    if (!inquiry || cardState === 'sending' || cardState === 'sent') return;
    setCardState('sending');
    try {
      const res = await fetch('/api/chat/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inquiry),
      });
      setCardState(res.ok ? 'sent' : 'error');
    } catch {
      setCardState('error');
    }
  }

  const greeting = messages.length === 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? t('close') : t('launcher')}
        aria-expanded={open}
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-fill text-white shadow-lg transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('title')}
          className="fixed bottom-24 right-5 z-40 flex h-[32rem] max-h-[calc(100vh-8rem)] w-[calc(100vw-2.5rem)] max-w-sm flex-col overflow-hidden rounded-3xl border border-gray-200 bg-card shadow-2xl"
        >
          <header className="border-b border-gray-100 px-5 py-4">
            <h2 className="text-sm font-bold">{t('title')}</h2>
            <p className="text-xs text-gray-400">{t('disclaimer')}</p>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {greeting && <p className="text-sm text-gray-500">{t('greeting')}</p>}

            {messages.map((message, i) => (
              <div
                key={i}
                className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <p
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    message.role === 'user'
                      ? 'bg-brand-fill text-white'
                      : 'bg-gray-50 text-gray-700'
                  }`}
                >
                  {message.content}
                </p>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <span className="flex items-center gap-2 rounded-2xl bg-gray-50 px-4 py-2.5 text-sm text-gray-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('thinking')}
                </span>
              </div>
            )}

            {inquiry && <InquiryCard draft={inquiry} state={cardState} onSend={confirmInquiry} />}

            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>

          <form onSubmit={send} className="flex items-center gap-2 border-t border-gray-100 p-3">
            <input
              ref={inputRef}
              type="text"
              value={input}
              maxLength={MAX_INPUT_CHARS}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('placeholder')}
              aria-label={t('placeholder')}
              className="flex-1 rounded-xl border border-gray-200 bg-card px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              type="submit"
              disabled={loading || input.trim() === ''}
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
  onSend,
}: {
  draft: InquiryDraft;
  state: CardState;
  onSend: () => void;
}) {
  const t = useTranslations('chat');

  if (state === 'sent') {
    return (
      <div className="rounded-2xl border border-green-100 bg-green-50 p-4 text-center">
        <CheckCircle className="mx-auto mb-2 h-6 w-6 text-green-500" />
        <p className="text-sm font-semibold">{t('cardSent')}</p>
      </div>
    );
  }

  const rows: [string, string | undefined][] = [
    [t('cardName'), draft.name],
    [t('cardEmail'), draft.email],
    [t('cardCompany'), draft.company],
    [t('cardMessage'), draft.message],
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
      <p className="mb-3 text-sm font-bold">{t('cardTitle')}</p>
      <dl className="mb-4 space-y-1.5">
        {rows
          .filter((row): row is [string, string] => Boolean(row[1]))
          .map(([label, value]) => (
            <div key={label} className="flex gap-2 text-xs">
              <dt className="shrink-0 font-semibold text-gray-500">{label}</dt>
              <dd className="text-gray-700">{value}</dd>
            </div>
          ))}
      </dl>
      {state === 'error' && <p className="mb-2 text-xs text-red-500">{t('cardError')}</p>}
      <button
        type="button"
        onClick={onSend}
        disabled={state === 'sending'}
        className="w-full rounded-xl bg-brand-fill py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {state === 'sending' ? t('cardSending') : t('cardSend')}
      </button>
    </div>
  );
}
