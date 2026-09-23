import ProjectRow from '@/components/portfolio/ProjectRow';
import { getTranslations } from 'next-intl/server';

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

export default async function PortfolioGridModule({
  data,
  pageHeading = true,
}: {
  data: PortfolioGridData;
  pageHeading?: boolean;
}) {
  const t = await getTranslations('portfolio');
  const Heading = pageHeading ? 'h1' : 'h2';
  return (
    <section className="pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto">
      <div className="text-center mb-16">
        {data.heading && (
          <Heading
            className={`${pageHeading ? 'text-4xl md:text-6xl' : 'text-3xl md:text-4xl'} font-bold mb-6`}
          >
            {data.heading}
          </Heading>
        )}
        {data.description && (
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            {data.description}
          </p>
        )}
      </div>
      {data.projects && data.projects.length > 0 && (
        <div className="mt-4">
          {data.projects.map((project, index) => (
            <ProjectRow
              key={project._key ?? project.url ?? index}
              project={project}
              index={index}
              total={data.projects!.length}
              visitLabel={data.visitSiteLabel ?? t('visitSite')}
            />
          ))}
        </div>
      )}
    </section>
  );
}
