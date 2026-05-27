type StatItem = { _key?: string; value: string; label: string };

type AboutIntroData = {
  heading?: string;
  paragraphs?: string[];
  stats?: StatItem[];
  founder?: {
    name?: string;
    role?: string;
    image?: { asset?: unknown };
  };
};

export default function AboutIntroModule({ data }: { data: AboutIntroData }) {
  return (
    <section className="pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        <div>
          {data.heading && (
            <h1 className="text-4xl md:text-6xl font-bold mb-6">{data.heading}</h1>
          )}
          {data.paragraphs?.map((p, i) => (
            <p key={i} className="text-lg text-gray-600 mb-6">{p}</p>
          ))}
          {data.stats && data.stats.length > 0 && (
            <div className="grid grid-cols-2 gap-6 mt-12">
              {data.stats.map((stat, i) => (
                <div key={stat._key ?? i} className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                  <p className="text-3xl font-bold text-primary mb-2">{stat.value}</p>
                  <p className="text-gray-600">{stat.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-gray-100 rounded-3xl p-12 flex items-center justify-center min-h-[500px]">
          <div className="text-center">
            <div className="w-64 h-64 bg-gray-300 rounded-full mx-auto mb-8 flex items-center justify-center overflow-hidden">
              {data.founder?.name && (
                <span className="text-gray-500 text-4xl font-bold">
                  {data.founder.name.charAt(0)}
                </span>
              )}
            </div>
            {data.founder?.name && (
              <h3 className="text-2xl font-bold mb-2">{data.founder.name}</h3>
            )}
            {data.founder?.role && (
              <p className="text-gray-600">{data.founder.role}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
