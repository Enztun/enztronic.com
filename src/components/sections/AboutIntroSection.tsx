import Image from 'next/image';
import { FOUNDER_PORTRAIT } from '@/lib/screenshots';
import type { Stat } from './types';

interface AboutIntroSectionProps {
  heading?: string;
  paragraphs?: string[];
  stats?: Stat[];
  founder?: { name?: string; role?: string };
}

/** The About opener: story and figures beside the founder card. */
export default function AboutIntroSection({
  heading,
  paragraphs,
  stats,
  founder,
}: AboutIntroSectionProps) {
  return (
    <section className="pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div className="min-w-0">
          {heading && (
            <h1 className="text-4xl md:text-6xl font-bold mb-6">{heading}</h1>
          )}
          {paragraphs?.map((p, i) => (
            <p key={i} className="text-lg text-gray-600 mb-6">
              {p}
            </p>
          ))}
          {stats && stats.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:gap-6 mt-10">
              {stats.map((stat, i) => (
                <div
                  key={stat.label ?? i}
                  className="min-w-0 bg-surface-muted p-4 sm:p-6 rounded-xl border border-line"
                >
                  <p className="text-xl sm:text-3xl font-bold text-brand mb-2 break-words">
                    {stat.value}
                  </p>
                  <p className="text-on-surface-variant break-words">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="min-w-0 bg-surface-muted rounded-3xl p-6 sm:p-12 flex items-center justify-center min-h-[360px] sm:min-h-[500px]">
          <div className="w-full max-w-xs min-w-0 text-center">
            <div className="relative mx-auto mb-8 aspect-square w-full max-w-64 overflow-hidden rounded-full ring-1 ring-line shadow-lg">
              <Image
                src={FOUNDER_PORTRAIT}
                alt={founder?.name ?? 'Founder portrait'}
                width={640}
                height={640}
                sizes="256px"
                className="h-full w-full object-cover"
              />
            </div>
            {founder?.name && (
              <h3 className="text-2xl font-bold mb-2">{founder.name}</h3>
            )}
            {founder?.role && <p className="text-gray-600">{founder.role}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
