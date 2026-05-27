'use client';

import Image from 'next/image';
import { useState } from 'react';
import { Menu, X, MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import LocaleSwitcher from '@/components/LocaleSwitcher';

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
    <nav className="fixed top-0 w-full bg-white/40 backdrop-blur-xl z-50 border-b border-white/20">
      <div className="px-6 md:px-12 max-w-7xl mx-auto h-20 flex justify-between items-center">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/logo-transparent.png"
            alt="ENZTRONIC logo"
            width={160}
            height={40}
            className="object-contain"
          />
        </Link>

        {/* Desktop Menu */}
        <div className="hidden md:flex gap-8 items-center">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="text-sm font-medium text-gray-700 hover:text-primary transition-colors"
            >
              {label}
            </Link>
          ))}
          <LocaleSwitcher />
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 bg-gray-900 text-white text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-primary transition-colors"
          >
            <MessageCircle className="w-4 h-4" />
            {t('cta')}
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="md:hidden p-2 rounded-lg hover:bg-white/20 transition-colors"
          aria-label="Toggle menu"
        >
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden bg-white/95 backdrop-blur-xl border-t border-white/20">
          <div className="px-6 py-4 space-y-1">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="block py-3 text-gray-700 hover:text-primary transition-colors font-medium border-b border-gray-100 last:border-0"
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
