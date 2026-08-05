'use client';

import { useState } from 'react';
import { Menu, X, MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import LocaleSwitcher from '@/components/LocaleSwitcher';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const t = useTranslations('nav');

  const links = [
    { href: '/services', label: t('services') },
    { href: '/portfolio', label: t('portfolio') },
    { href: '/about', label: t('about') },
    { href: '/blog', label: t('blog') },
    { href: '/contact', label: t('contact') },
  ];

  return (
    <nav className="fixed top-0 w-full bg-surface/70 backdrop-blur-xl z-50 border-b border-line/60">
      <div className="px-6 md:px-12 max-w-7xl mx-auto h-20 flex justify-between items-center">
        <Link href="/" className="flex shrink-0 items-center gap-3">
          <BrandLogo variant="mark" height={40} priority />
          <span className="hidden text-lg font-extrabold tracking-[0.14em] text-on-surface sm:block">
            ENZTRONIC
          </span>
        </Link>

        {/* Desktop Menu */}
        <div className="hidden md:flex gap-8 items-center">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="text-sm font-medium text-on-surface-variant hover:text-brand transition-colors"
            >
              {label}
            </Link>
          ))}
          <LocaleSwitcher />
          <ThemeToggle />
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 bg-navy text-white text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-brand transition-colors"
          >
            <MessageCircle className="w-4 h-4" />
            {t('cta')}
          </Link>
        </div>

        {/* Mobile: theme toggle stays in the bar so switching does not
            require opening navigation first. */}
        <div className="flex items-center gap-1 md:hidden">
          <ThemeToggle compact />
          <button
            onClick={() => setIsOpen((v) => !v)}
            className="p-2 rounded-lg hover:bg-surface-muted transition-colors"
            aria-label="Toggle menu"
          >
            {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden bg-surface/95 backdrop-blur-xl border-t border-line/60">
          <div className="px-6 py-4 space-y-1">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="block py-3 text-on-surface-variant hover:text-brand transition-colors font-medium border-b border-line/50 last:border-0"
                onClick={() => setIsOpen(false)}
              >
                {label}
              </Link>
            ))}
            <div className="pt-4 flex items-center justify-between">
              <LocaleSwitcher />
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 bg-gray-900 text-white text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-primary transition-colors"
                onClick={() => setIsOpen(false)}
              >
                <MessageCircle className="w-4 h-4" />
                {t('cta')}
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
