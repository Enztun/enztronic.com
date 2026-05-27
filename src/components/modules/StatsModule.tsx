type StatItem = { value: string; label: string; _key?: string };

export default function StatsModule({ data }: { data: { items?: StatItem[] } }) {
  if (!data.items?.length) return null;
  return (
    <section className="py-20 bg-gray-50 border-y border-gray-200">
      <div className="px-6 md:px-12 max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
        {data.items.map((item, i) => (
          <div key={item._key ?? i}>
            <p className="text-3xl md:text-4xl font-bold">{item.value}</p>
            <p className="text-sm text-gray-500 uppercase tracking-wider mt-2">{item.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
