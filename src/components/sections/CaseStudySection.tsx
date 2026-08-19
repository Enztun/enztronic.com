import Image from 'next/image';
import { CheckCircle, ArrowRight } from 'lucide-react';
import { FEATURED_SCREENSHOT } from '@/lib/screenshots';
import type { Cta } from './types';

interface CaseStudySectionProps {
  label?: string;
  title?: string;
  description?: string;
  features?: string[];
  cta?: Cta;
  imageAlt?: string;
}

/** The featured-project panel: the work on one side, the story on the other. */
export default function CaseStudySection({
  label,
  title,
  description,
  features,
  cta,
  imageAlt,
}: CaseStudySectionProps) {
  return (
    <section className="py-24 px-6 md:px-12 max-w-7xl mx-auto">
      <div className="bg-gray-50 rounded-3xl overflow-hidden grid grid-cols-1 lg:grid-cols-2 border border-gray-200">
        <div className="bg-gray-200/50 flex items-center justify-center p-12">
          <div className="w-full h-[400px] overflow-hidden rounded-xl border border-white/70 dark:border-white/10 shadow-lg">
            <Image
              src={FEATURED_SCREENSHOT}
              alt={imageAlt ?? title ?? 'Featured project'}
              width={1440}
              height={900}
              sizes="(min-width: 1024px) 45vw, 90vw"
              className="h-full w-full object-cover object-top"
            />
          </div>
        </div>
        <div className="p-16 flex flex-col justify-center">
          {label && (
            <span className="text-primary font-bold tracking-widest text-sm mb-4 uppercase">
              {label}
            </span>
          )}
          {title && <h2 className="text-3xl md:text-4xl font-bold mb-6">{title}</h2>}
          {description && (
            <p className="text-base text-gray-600 mb-8 leading-relaxed">{description}</p>
          )}
          {features && features.length > 0 && (
            <ul className="space-y-4 mb-10">
              {features.map((feature) => (
                <li key={feature} className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-primary flex-shrink-0" />
                  <span className="text-base">{feature}</span>
                </li>
              ))}
            </ul>
          )}
          {cta?.text && cta.href && (
            <a
              href={cta.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-primary font-bold group w-fit"
            >
              {cta.text}{' '}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
