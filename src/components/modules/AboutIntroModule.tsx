import AboutIntroSection from '@/components/sections/AboutIntroSection';

type StatItem = { _key?: string; value?: string; label?: string };

type AboutIntroData = {
  heading?: string;
  paragraphs?: string[];
  stats?: StatItem[];
  founder?: { name?: string; role?: string; image?: { asset?: unknown } };
};

export default function AboutIntroModule({ data }: { data: AboutIntroData }) {
  return (
    <AboutIntroSection
      heading={data.heading}
      paragraphs={data.paragraphs}
      stats={data.stats}
      founder={data.founder}
    />
  );
}
