'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { BrandLogo } from '@/components/BrandLogo';

export default function Footer() {
  const t = useTranslations('footer');

  return (
    <footer className="surface-dark py-16">
      <div className="px-6 md:px-12 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          <div>
            <BrandLogo variant="lockup" surface="dark" height={44} />
            <p className="mt-4 text-sm text-white/70">{t('tagline')}</p>
          </div>

          <div>
            <h4 className="font-bold mb-4">{t('sections.services')}</h4>
            <ul className="space-y-2 text-white/70 text-sm">
              <li>
                <Link
                  href="/services"
                  className="hover:text-primary transition-colors"
                >
                  {t('links.webDev')}
                </Link>
              </li>
              <li>
                <Link
                  href="/services"
                  className="hover:text-primary transition-colors"
                >
                  {t('links.digitalMarketing')}
                </Link>
              </li>
              <li>
                <Link
                  href="/services"
                  className="hover:text-primary transition-colors"
                >
                  {t('links.paidAds')}
                </Link>
              </li>
              <li>
                <Link
                  href="/services"
                  className="hover:text-primary transition-colors"
                >
                  {t('links.branding')}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold mb-4">{t('sections.company')}</h4>
            <ul className="space-y-2 text-white/70 text-sm">
              <li>
                <Link
                  href="/about"
                  className="hover:text-primary transition-colors"
                >
                  {t('links.about')}
                </Link>
              </li>
              <li>
                <Link
                  href="/portfolio"
                  className="hover:text-primary transition-colors"
                >
                  {t('links.portfolio')}
                </Link>
              </li>
              <li>
                <Link
                  href="/blog"
                  className="hover:text-primary transition-colors"
                >
                  {t('links.blog')}
                </Link>
              </li>
              <li>
                <Link
                  href="/contact"
                  className="hover:text-primary transition-colors"
                >
                  {t('links.contact')}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold mb-4">{t('sections.connect')}</h4>
            <ul className="space-y-2 text-white/70 text-sm">
              <li>
                <a href="#" className="hover:text-primary transition-colors">
                  {t('links.linkedin')}
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-primary transition-colors">
                  {t('links.twitter')}
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-primary transition-colors">
                  {t('links.instagram')}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/15 mt-12 pt-8 text-center text-white/70 text-sm">
          <p>{t('copyright', { year: new Date().getFullYear() })}</p>
        </div>
      </div>
    </footer>
  );
}
