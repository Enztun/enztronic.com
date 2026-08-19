import ServicesSection from '@/components/sections/ServicesSection';
import { serviceIcon } from '@/lib/service-icons';

type ServiceItem = {
  _key?: string;
  title?: string;
  description?: string;
  icon?: string;
  features?: string[];
};

type ServicesGridData = {
  heading?: string;
  subheading?: string;
  services?: ServiceItem[];
};

/** Sanity stores the icon by name; the section wants the component. */
export default function ServicesGridModule({ data }: { data: ServicesGridData }) {
  return (
    <ServicesSection
      heading={data.heading}
      subheading={data.subheading}
      services={(data.services ?? []).map((s, i) => ({
        title: s.title,
        description: s.description,
        features: s.features,
        icon: serviceIcon(s.icon ?? i),
      }))}
    />
  );
}
