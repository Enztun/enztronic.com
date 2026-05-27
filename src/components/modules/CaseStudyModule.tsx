import { CheckCircle, ArrowRight } from 'lucide-react';

type CaseStudyData = {
  label?: string;
  title?: string;
  description?: string;
  features?: string[];
  ctaText?: string;
  ctaHref?: string;
};

export default function CaseStudyModule({ data }: { data: CaseStudyData }) {
  return (
    <section className="py-24 px-6 md:px-12 max-w-7xl mx-auto">
      <div className="bg-gray-50 rounded-3xl overflow-hidden grid grid-cols-1 lg:grid-cols-2 border border-gray-200">
        <div className="bg-gray-200/50 flex items-center justify-center p-12">
          <div className="w-full h-[400px] bg-white/50 backdrop-blur-sm rounded-xl border border-white flex items-center justify-center text-gray-500 italic">
            {data.title}
          </div>
        </div>
        <div className="p-16 flex flex-col justify-center">
          {data.label && (
            <span className="text-primary font-bold tracking-widest text-sm mb-4 uppercase">
              {data.label}
            </span>
          )}
          {data.title && (
            <h2 className="text-3xl md:text-4xl font-bold mb-6">{data.title}</h2>
          )}
          {data.description && (
            <p className="text-base text-gray-600 mb-8 leading-relaxed">{data.description}</p>
          )}
          {data.features && data.features.length > 0 && (
            <ul className="space-y-4 mb-10">
              {data.features.map((feature, i) => (
                <li key={i} className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-primary flex-shrink-0" />
                  <span className="text-base">{feature}</span>
                </li>
              ))}
            </ul>
          )}
          {data.ctaText && data.ctaHref && (
            <a
              href={data.ctaHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-primary font-bold group w-fit"
            >
              {data.ctaText}{' '}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
