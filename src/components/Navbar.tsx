'use client';

import Image from 'next/image';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import LocaleSwitcher from '@/components/LocaleSwitcher';

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const t = useTranslations('nav');

  const toggleMenu = () => setIsOpen(!isOpen);

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
        <div className="hidden md:flex gap-10 items-center">
          <Link
            href="/services"
            className="text-base font-medium text-gray-700 hover:text-primary transition-colors"
          >
            {t('services')}
          </Link>
          <Link
            href="/portfolio"
            className="text-base font-medium text-gray-700 hover:text-primary transition-colors"
          >
            {t('portfolio')}
          </Link>
          <Link
            href="/about"
            className="text-base font-medium text-gray-700 hover:text-primary transition-colors"
          >
            {t('about')}
          </Link>
          <Link
            href="/blog"
            className="text-base font-medium text-gray-700 hover:text-primary transition-colors"
          >
            {t('blog')}
          </Link>
          <LocaleSwitcher />
        </div>

        {/* Mobile Menu Button */}
        <button
          onClick={toggleMenu}
          className="md:hidden p-2 rounded-lg hover:bg-white/20 transition-colors"
          aria-label="Toggle menu"
        >
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden bg-white/50 backdrop-blur-xl border-t border-white/20">
          <div className="px-6 py-4 space-y-4">
            <Link
              href="/services"
              className="block text-gray-700 hover:text-primary transition-colors font-medium"
              onClick={() => setIsOpen(false)}
            >
              {t('services')}
            </Link>
            <Link
              href="/portfolio"
              className="block text-gray-700 hover:text-primary transition-colors font-medium"
              onClick={() => setIsOpen(false)}
            >
              {t('portfolio')}
            </Link>
            <Link
              href="/about"
              className="block text-gray-700 hover:text-primary transition-colors font-medium"
              onClick={() => setIsOpen(false)}
            >
              {t('about')}
            </Link>
            <Link
              href="/blog"
              className="block text-gray-700 hover:text-primary transition-colors font-medium"
              onClick={() => setIsOpen(false)}
            >
              {t('blog')}
            </Link>
            <div className="pt-2 border-t border-gray-100">
              <LocaleSwitcher />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
