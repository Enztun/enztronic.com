import { ArrowRight } from 'lucide-react';
import ImageWithFallback from '@/components/ImageWithFallback';

const defaultLaptopScreenshot = '/screenshots/placeholder-laptop.svg';
const defaultMobileScreenshot = '/screenshots/placeholder-mobile.svg';

type Project = {
  _key?: string;
  title?: string;
  category?: string;
  description?: string;
  url?: string;
  tags?: string[];
};

type PortfolioGridData = {
  heading?: string;
  description?: string;
  visitSiteLabel?: string;
  projects?: Project[];
};

export default function PortfolioGridModule({ data }: { data: PortfolioGridData }) {
  return (
    <section className="pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto">
      <div className="text-center mb-16">
        {data.heading && (
          <h1 className="text-4xl md:text-6xl font-bold mb-6">{data.heading}</h1>
        )}
        {data.description && (
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">{data.description}</p>
        )}
      </div>
      {data.projects && data.projects.length > 0 && (
        <div className="grid gap-8">
          {data.projects.map((project, index) => (
            <article
              key={project._key ?? project.url ?? index}
              className="group overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-50/80 shadow-sm transition hover:shadow-xl"
            >
              <div className="grid gap-6 md:grid-cols-[1fr_0.8fr] p-6">
                <div className="relative flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl p-8 min-h-[400px]">
                  <div className="relative w-full max-w-lg">
                    <div className="relative rounded-xl bg-slate-900 p-2 shadow-2xl">
                      <div className="absolute left-1/2 top-0 h-3 w-20 -translate-x-1/2 -translate-y-1/2 rounded-b-lg bg-slate-800 z-10">
                        <div className="mx-auto mt-1.5 h-1.5 w-1.5 rounded-full bg-slate-700" />
                      </div>
                      <div className="rounded-lg bg-slate-800 p-1">
                        <div className="overflow-hidden rounded-md bg-white aspect-video relative">
                          <ImageWithFallback
                            src={defaultLaptopScreenshot}
                            alt={`${project.title} laptop preview`}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="mt-0 h-3 bg-gradient-to-b from-slate-400 to-slate-500 rounded-b-xl shadow-lg" />
                    <div className="h-1 bg-slate-600 rounded-b-lg" />
                  </div>
                </div>
                <div className="relative flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl p-8">
                  <div className="relative">
                    <div className="relative w-[280px] h-[560px] bg-slate-900 rounded-[3rem] p-3 shadow-2xl border-4 border-slate-800">
                      <div className="absolute left-1/2 top-3 h-7 w-28 -translate-x-1/2 bg-black rounded-full z-10" />
                      <div className="h-full w-full rounded-[2.5rem] bg-white overflow-hidden relative">
                        <ImageWithFallback
                          src={defaultMobileScreenshot}
                          alt={`${project.title} mobile preview`}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="absolute left-0 top-20 h-8 w-1 bg-slate-700 rounded-l" />
                      <div className="absolute left-0 top-32 h-12 w-1 bg-slate-700 rounded-l" />
                      <div className="absolute right-0 top-28 h-16 w-1 bg-slate-700 rounded-r" />
                    </div>
                  </div>
                </div>
                <div className="md:col-span-2 flex flex-col justify-between gap-6 pt-4">
                  <div className="space-y-5">
                    {project.category && (
                      <span className="inline-flex rounded-full bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">
                        {project.category}
                      </span>
                    )}
                    <div className="space-y-3">
                      {project.description && (
                        <p className="text-gray-700">{project.description}</p>
                      )}
                      {project.tags && project.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {project.tags.map((tag, idx) => (
                            <span
                              key={idx}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {project.url && (
                    <div className="flex flex-col gap-3">
                      <a
                        href={project.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 w-fit"
                      >
                        {data.visitSiteLabel ?? 'Visit Site'}{' '}
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
