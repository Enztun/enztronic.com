'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { BrandLogo } from '@/components/BrandLogo';
import { SERVICE_LINKS } from '@/components/sections/service-links';

export default function Footer() {
  const t = useTranslations('footer');
  const services = useTranslations('services').raw('items') as {
    title: string;
  }[];
  const contact = useTranslations('contact');

  return (
    <footer className="surface-dark py-16">
      <div className="px-6 md:px-12 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
          <div className="min-w-0">
            <BrandLogo variant="lockup" surface="dark" height={44} />
            <p className="mt-4 text-base leading-relaxed text-white/70">
              {t('tagline')}
            </p>
          </div>
          <div>
            <h2 className="font-bold text-base mb-4">
              {t('sections.services')}
            </h2>
            <ul className="space-y-3 text-white/75 text-base">
              {services.map((service, index) => (
                <li key={service.title}>
                  <Link
                    href={`/services#${SERVICE_LINKS[index]?.id ?? 'how-we-work'}`}
                    className="hover:text-white transition-colors"
                  >
                    {service.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="font-bold text-base mb-4">
              {t('sections.company')}
            </h2>
            <ul className="space-y-3 text-white/75 text-base">
              {(['about', 'portfolio', 'blog', 'contact'] as const).map(
                (page) => (
                  <li key={page}>
                    <Link
                      href={`/${page}`}
                      className="hover:text-white transition-colors"
                    >
                      {t(`links.${page}`)}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-base mb-4">
              {t('sections.connect')}
            </h2>
            <ul className="space-y-3 text-white/75 text-base">
              <li>
                <a
                  href="mailto:enztun@enztronic.com"
                  className="break-words hover:text-white transition-colors"
                >
                  enztun@enztronic.com
                </a>
              </li>
              <li>
                <a
                  href="https://wa.me/6289637579728"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  {contact('phone')}
                </a>
              </li>
              <li>{contact('officeLocation')}</li>
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
