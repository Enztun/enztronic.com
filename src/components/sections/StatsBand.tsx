import type { Stat } from './types';

/** The four-up figures strip. */
export default function StatsBand({ items }: { items: Stat[] }) {
  if (!items.length) return null;
  return (
    <section className="py-16 bg-gray-50 border-y border-gray-200">
      <div className="px-6 md:px-12 max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
        {items.map((item, i) => (
          <div key={item.label ?? i}>
            <p className="text-3xl md:text-4xl font-bold">{item.value}</p>
            <p className="text-sm text-gray-500 uppercase tracking-wider mt-2">{item.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
