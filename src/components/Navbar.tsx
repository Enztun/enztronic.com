'use client';

import { useEffect, useRef, useState } from 'react';
import { Menu, X, MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import LocaleSwitcher from '@/components/LocaleSwitcher';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function Navbar({ articleLocales }: { articleLocales?: string[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const t = useTranslations('nav');
  const ux = useTranslations('navigationUx');

  useEffect(() => {
    if (!isOpen) return;
    menuRef.current?.querySelector<HTMLAnchorElement>('a')?.focus();
    const closeOnOutside = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    const desktop = window.matchMedia('(min-width: 1280px)');
    const closeOnDesktop = () => { if (desktop.matches) setIsOpen(false); };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
      desktop.removeEventListener('change', closeOnDesktop);
    };
  }, [isOpen]);

  const links = [
    { href: '/services', label: t('services') },
    { href: '/portfolio', label: t('portfolio') },
    { href: '/about', label: t('about') },
    { href: '/blog', label: t('blog') },
    { href: '/contact', label: t('contact') },
  ];
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(href + '/')
    || (href === '/blog' && pathname.startsWith('/guides/'));

  return (
    <nav ref={navRef} aria-label={ux('mainNavigation')}
      className="fixed top-0 w-full bg-surface/95 backdrop-blur-xl z-50 border-b border-line/60"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
      }}>
      <div className="px-6 md:px-12 max-w-7xl mx-auto h-20 flex justify-between items-center gap-6">
        <Link href="/" aria-label={ux('home')} onClick={() => setIsOpen(false)} className="flex shrink-0 items-center gap-3 rounded-md">
          <BrandLogo variant="mark" height={40} priority />
          <span className="hidden text-lg font-extrabold tracking-[0.14em] text-on-surface sm:block">ENZTRONIC</span>
        </Link>
        <div className="hidden xl:flex gap-5 items-center">
          {links.map(({ href, label }) => (
            <Link key={href} href={href} aria-current={isCurrent(href) ? 'page' : undefined}
              className={'rounded-sm py-2 text-sm font-semibold transition-colors ' + (isCurrent(href) ? 'text-brand underline underline-offset-8 decoration-2' : 'text-on-surface-variant hover:text-brand')}>
              {label}
            </Link>
          ))}
          <LocaleSwitcher articleLocales={articleLocales} />
          <ThemeToggle />
          <Link href="/contact" className="inline-flex shrink-0 items-center gap-2 bg-navy dark:bg-brand-fill text-white text-sm font-semibold px-5 py-3 rounded-full hover:bg-brand-fill dark:hover:bg-brand-fill-strong transition-colors">
            <MessageCircle aria-hidden="true" className="w-4 h-4" />{t('cta')}
          </Link>
        </div>
        <div className="flex items-center gap-2 xl:hidden">
          <ThemeToggle compact />
          <button ref={triggerRef} type="button" onClick={() => setIsOpen((value) => !value)}
            className="grid size-11 place-items-center rounded-lg hover:bg-surface-muted transition-colors"
            aria-label={isOpen ? ux('closeMenu') : ux('openMenu')} aria-expanded={isOpen} aria-controls="mobile-navigation">
            {isOpen ? <X aria-hidden="true" className="w-6 h-6" /> : <Menu aria-hidden="true" className="w-6 h-6" />}
          </button>
        </div>
      </div>
      {isOpen && (
        <div ref={menuRef} id="mobile-navigation" className="ui-enter xl:hidden max-h-[calc(100dvh-5rem)] overflow-y-auto bg-surface border-t border-line/60">
          <div className="px-6 py-4 space-y-1">
            {links.map(({ href, label }) => (
              <Link key={href} href={href} aria-current={isCurrent(href) ? 'page' : undefined}
                className={'block rounded-lg px-3 py-3 transition-colors font-medium ' + (isCurrent(href) ? 'bg-surface-muted text-brand font-bold' : 'text-on-surface-variant hover:bg-surface-muted hover:text-brand')}
                onClick={() => setIsOpen(false)}>{label}</Link>
            ))}
            <div className="pt-4 flex flex-wrap items-start justify-between gap-4 border-t border-line">
              <LocaleSwitcher inline articleLocales={articleLocales} onNavigate={() => setIsOpen(false)} />
              <Link href="/contact" onClick={() => setIsOpen(false)} className="inline-flex items-center gap-2 bg-navy dark:bg-brand-fill text-white text-sm font-semibold px-5 py-3 rounded-full hover:bg-brand-fill dark:hover:bg-brand-fill-strong transition-colors">
                <MessageCircle aria-hidden="true" className="w-4 h-4" />{t('cta')}
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
