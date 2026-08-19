import Image from 'next/image';
import { ArrowUpRight } from 'lucide-react';
import { screenshotFor } from '@/lib/screenshots';

export type PortfolioProject = {
  title?: string;
  category?: string;
  description?: string;
  url?: string;
  tags?: string[];
};

interface ProjectRowProps {
  project: PortfolioProject;
  /** 0-based; drives the running number and which side the image sits on. */
  index: number;
  total: number;
  visitLabel: string;
}

/**
 * One case-study row: copy on one side, the work on the other, mirrored every
 * other row.
 *
 * Shared rather than written twice because /portfolio has two render paths --
 * the Sanity module and the locale-file fallback -- and they have to stay
 * identical. The old markup was duplicated across both and had already drifted.
 *
 * The screenshot is a plain laptop-proportioned frame instead of the drawn
 * laptop-and-phone mockups it replaces: those spent most of their pixels on
 * bezel and shrank the actual work to a thumbnail. The phone shot rides along
 * as an inset, which shows the responsive build without costing a second
 * full-size slot.
 */
export default function ProjectRow({ project, index, total, visitLabel }: ProjectRowProps) {
  const flipped = index % 2 === 1;
  const number = String(index + 1).padStart(2, '0');
  const totalLabel = String(total).padStart(2, '0');

  return (
    <article className="group relative border-t border-gray-200 py-16 md:py-24 first:border-t-0 first:pt-0">
      <div
        className={`grid items-center gap-10 lg:grid-cols-12 lg:gap-16 ${
          flipped ? 'lg:[&>*:first-child]:order-2' : ''
        }`}
      >
        {/* ── Copy ── */}
        <div className="lg:col-span-5">
          <div className="mb-5 flex items-baseline gap-3">
            <span className="text-sm font-bold tabular-nums text-brand">{number}</span>
            <span className="h-px w-8 bg-gray-300" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
              {project.category}
            </span>
          </div>

          <h2 className="mb-5 text-3xl font-bold leading-tight md:text-4xl">{project.title}</h2>

          {project.description && (
            <p className="mb-7 max-w-md leading-relaxed text-gray-600">{project.description}</p>
          )}

          {project.tags && project.tags.length > 0 && (
            <ul className="mb-8 flex flex-wrap gap-2">
              {project.tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600"
                >
                  {tag}
                </li>
              ))}
            </ul>
          )}

          {project.url && (
            <a
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group/link inline-flex items-center gap-2 text-sm font-bold text-brand transition-colors hover:text-brand-strong"
            >
              {visitLabel}
              <ArrowUpRight
                aria-hidden="true"
                className="h-4 w-4 transition-transform group-hover/link:-translate-y-0.5 group-hover/link:translate-x-0.5"
              />
            </a>
          )}
        </div>

        {/* ── The work ── */}
        <div className="lg:col-span-7">
          <div className="relative">
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-card shadow-lg transition-shadow duration-300 group-hover:shadow-2xl">
              {/* A restrained browser bar: enough to read as a screen without
                  drawing a whole machine around it. */}
              <div className="flex items-center gap-1.5 border-b border-gray-200 bg-surface-muted px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
                {project.url && (
                  <span className="ml-3 truncate text-[11px] text-gray-500">
                    {project.url.replace(/^https?:\/\//, '')}
                  </span>
                )}
              </div>
              <Image
                src={screenshotFor(project.url, 'laptop')}
                alt={project.title ? `${project.title} website` : 'Project screenshot'}
                width={1440}
                height={900}
                sizes="(min-width: 1024px) 58vw, 92vw"
                className="aspect-[16/10] w-full object-cover object-top"
              />
            </div>

            {/* Mobile build, tucked into the outer corner so it never covers
                the middle of the desktop shot. */}
            <div
              className={`absolute -bottom-6 hidden w-[104px] overflow-hidden rounded-xl border border-gray-200 bg-card shadow-xl sm:block ${
                flipped ? '-right-4 lg:-right-6' : '-left-4 lg:-left-6'
              }`}
            >
              <Image
                src={screenshotFor(project.url, 'mobile')}
                alt=""
                aria-hidden="true"
                width={585}
                height={1266}
                sizes="104px"
                className="aspect-[9/16] w-full object-cover object-top"
              />
            </div>
          </div>
        </div>
      </div>

      <span className="sr-only">
        Project {number} of {totalLabel}
      </span>
    </article>
  );
}
