import ProjectRow from '@/components/portfolio/ProjectRow';


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
        <div className="mt-4">
          {data.projects.map((project, index) => (
            <ProjectRow
              key={project._key ?? project.url ?? index}
              project={project}
              index={index}
              total={data.projects!.length}
              visitLabel={data.visitSiteLabel ?? 'Visit Site'}
            />
          ))}
        </div>
      )}
    </section>
  );
}
