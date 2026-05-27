import { Code, Megaphone, Target, Palette, TrendingUp, Users, LucideIcon } from 'lucide-react';

const iconMap: Record<string, LucideIcon> = {
  Code, Megaphone, Target, Palette, TrendingUp, Users,
};

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

export default function ServicesGridModule({ data }: { data: ServicesGridData }) {
  return (
    <section className="pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto">
      <div className="text-center mb-16">
        {data.heading && (
          <h1 className="text-4xl md:text-6xl font-bold mb-6">{data.heading}</h1>
        )}
        {data.subheading && (
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">{data.subheading}</p>
        )}
      </div>
      {data.services && data.services.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {data.services.map((service, index) => {
            const Icon: LucideIcon = (service.icon && iconMap[service.icon]) ? iconMap[service.icon] : Code;
            return (
              <div
                key={service._key ?? index}
                className="bg-gray-50 rounded-2xl p-8 border border-gray-200 hover:shadow-lg transition-shadow"
              >
                <Icon className="w-12 h-12 text-primary mb-6" />
                {service.title && <h3 className="text-2xl font-bold mb-4">{service.title}</h3>}
                {service.description && (
                  <p className="text-gray-600 mb-6">{service.description}</p>
                )}
                {service.features && service.features.length > 0 && (
                  <ul className="space-y-2">
                    {service.features.map((feature, idx) => (
                      <li key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                        <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
