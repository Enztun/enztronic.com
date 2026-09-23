'use client';

import { useState, useRef, useEffect, useId, useTransition, type KeyboardEvent } from 'react';
import { Globe, ChevronDown, Check, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';

const locales = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'id', label: 'Bahasa Indonesia', short: 'ID' },
  { code: 'zh', label: '中文', short: 'ZH' },
] as const;

export default function LocaleSwitcher({ inline = false, articleLocales, onNavigate }: {
  inline?: boolean;
  articleLocales?: string[];
  onNavigate?: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations('navigationUx');
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    function handleClick(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', handleClick);
    return () => document.removeEventListener('pointerdown', handleClick);
  }, [open]);

  function switchLocale(next: string) {
    setOpen(false);
    triggerRef.current?.focus();
    if (next === locale) return;
    const isArticle = pathname.startsWith('/blog/');
    // Retain a slug only when the server verified a published language version.
    const destination = isArticle && !articleLocales?.includes(next)
      ? { pathname: '/blog', query: { notice: 'translation-unavailable' } }
      : pathname + window.location.search + window.location.hash;
    startTransition(() => router.replace(destination, { locale: next }));
    onNavigate?.();
  }

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!open) { setOpen(true); return; }
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  const current = locales.find((entry) => entry.code === locale) ?? locales[0];
  return (
    <div ref={ref} className="relative" onKeyDown={handleKeys} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button ref={triggerRef} type="button" onClick={() => setOpen((value) => !value)} disabled={pending}
        className="flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-on-surface-variant hover:text-brand hover:bg-surface-muted transition-colors disabled:opacity-60"
        aria-label={t('switchLanguage', { language: current.label })} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} aria-busy={pending}>
        {pending ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Globe aria-hidden="true" className="w-4 h-4" />}
        {current.short}
        <ChevronDown aria-hidden="true" className={'w-3.5 h-3.5 transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>
      {open && (
        <div ref={menuRef} id={menuId} role="menu" aria-label={t('languageMenu')}
          className={'ui-enter w-52 max-w-[calc(100vw-3rem)] rounded-xl bg-card border border-line shadow-xl p-1 z-50 ' + (inline ? 'mt-2' : 'absolute right-0 mt-2')}>
          {locales.map((entry) => (
            <button key={entry.code} type="button" role="menuitemradio" tabIndex={-1} aria-checked={entry.code === locale} lang={entry.code}
              onClick={() => switchLocale(entry.code)} className={'w-full min-h-11 rounded-lg text-left px-3 py-2 text-sm flex items-center justify-between gap-3 transition-colors ' + (entry.code === locale ? 'text-brand font-bold bg-surface-muted' : 'text-on-surface-variant hover:bg-surface-muted')}>
              {entry.label}{entry.code === locale && <Check aria-hidden="true" className="w-4 h-4 shrink-0" />}
            </button>
          ))}
        </div>
      )}
      <span role="status" className="sr-only">{pending ? t('changingLanguage') : ''}</span>
    </div>
  );
}
