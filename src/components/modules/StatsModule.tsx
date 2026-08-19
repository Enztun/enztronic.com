import StatsBand from '@/components/sections/StatsBand';

type StatItem = { value?: string; label?: string; _key?: string };

export default function StatsModule({ data }: { data: { items?: StatItem[] } }) {
  return <StatsBand items={data.items ?? []} />;
}
