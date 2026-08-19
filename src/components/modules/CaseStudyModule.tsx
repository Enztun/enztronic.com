import CaseStudySection from '@/components/sections/CaseStudySection';

type CaseStudyData = {
  label?: string;
  title?: string;
  description?: string;
  features?: string[];
  ctaText?: string;
  ctaHref?: string;
};

export default function CaseStudyModule({ data }: { data: CaseStudyData }) {
  return (
    <CaseStudySection
      label={data.label}
      title={data.title}
      description={data.description}
      features={data.features}
      cta={{ text: data.ctaText, href: data.ctaHref }}
    />
  );
}
