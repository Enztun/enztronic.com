import type { Service } from './types';
import { getTranslations } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { SERVICE_LINKS } from './service-links';

interface ServicesSectionProps {
  heading?: string;
  subheading?: string;
  services: Service[];
  pageHeading?: boolean;
}

/** The full services grid, with each card's capability list. */
export default async function ServicesSection({
  heading,
  subheading,
  services,
  pageHeading = true,
}: ServicesSectionProps) {
  const t = await getTranslations('experience.services');
  const Heading = pageHeading ? 'h1' : 'h2';
  const CardHeading = pageHeading ? 'h2' : 'h3';
  return (
    <section
      id="services"
      className={`${pageHeading ? 'pt-32' : 'pt-16 md:pt-20'} pb-16 md:pb-20 px-6 md:px-12 max-w-7xl mx-auto`}
    >
      <div className="text-center mb-16">
        {heading && (
          <Heading
            className={`${pageHeading ? 'text-4xl md:text-6xl' : 'text-3xl md:text-4xl'} font-bold mb-6`}
          >
            {heading}
          </Heading>
        )}
        {subheading && (
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            {subheading}
          </p>
        )}
      </div>
      {services.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {services.map((service, index) => {
            const Icon = service.icon;
            return (
              <Link
                key={service.title ?? index}
                href={`/services#${SERVICE_LINKS[index]?.id ?? 'how-we-work'}`}
                className="group bg-surface-muted rounded-2xl p-6 md:p-8 border border-line hover:border-brand/40 hover:shadow-md transition-colors flex flex-col"
              >
                {Icon && <Icon className="w-12 h-12 text-primary mb-6" />}
                {service.title && (
                  <CardHeading className="text-2xl font-bold mb-4">
                    {service.title}
                  </CardHeading>
                )}
                {service.description && (
                  <p className="text-gray-600 mb-6">{service.description}</p>
                )}
                {pageHeading &&
                  service.features &&
                  service.features.length > 0 && (
                    <ul className="space-y-2">
                      {service.features.map((feature) => (
                        <li
                          key={feature}
                          className="flex items-center gap-2 text-base text-gray-700"
                        >
                          <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  )}
                <span className="inline-flex items-center gap-2 text-brand font-semibold mt-6 pt-2">
                  {t('explore')}{' '}
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
