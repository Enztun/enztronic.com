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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        <div>
          {heading && <h1 className="text-4xl md:text-6xl font-bold mb-6">{heading}</h1>}
          {paragraphs?.map((p, i) => (
            <p key={i} className="text-lg text-gray-600 mb-6">
              {p}
            </p>
          ))}
          {stats && stats.length > 0 && (
            <div className="grid grid-cols-2 gap-6 mt-12">
              {stats.map((stat, i) => (
                <div
                  key={stat.label ?? i}
                  className="bg-gray-50 p-6 rounded-xl border border-gray-200"
                >
                  <p className="text-3xl font-bold text-primary mb-2">{stat.value}</p>
                  <p className="text-gray-600">{stat.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-gray-100 rounded-3xl p-12 flex items-center justify-center min-h-[500px]">
          <div className="text-center">
            <div className="relative mx-auto mb-8 h-64 w-64 overflow-hidden rounded-full ring-1 ring-line shadow-lg">
              <Image
                src={FOUNDER_PORTRAIT}
                alt={founder?.name ?? 'Founder portrait'}
                width={640}
                height={640}
                sizes="256px"
                className="h-full w-full object-cover"
              />
            </div>
            {founder?.name && <h3 className="text-2xl font-bold mb-2">{founder.name}</h3>}
            {founder?.role && <p className="text-gray-600">{founder.role}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
