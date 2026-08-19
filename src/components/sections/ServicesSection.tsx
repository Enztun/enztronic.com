import type { Service } from './types';

interface ServicesSectionProps {
  heading?: string;
  subheading?: string;
  services: Service[];
}

/** The full services grid, with each card's capability list. */
export default function ServicesSection({ heading, subheading, services }: ServicesSectionProps) {
  return (
    <section className="pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto">
      <div className="text-center mb-16">
        {heading && <h1 className="text-4xl md:text-6xl font-bold mb-6">{heading}</h1>}
        {subheading && <p className="text-xl text-gray-600 max-w-2xl mx-auto">{subheading}</p>}
      </div>
      {services.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {services.map((service, index) => {
            const Icon = service.icon;
            return (
              <div
                key={service.title ?? index}
                className="bg-gray-50 rounded-2xl p-8 border border-gray-200 hover:shadow-lg transition-shadow"
              >
                {Icon && <Icon className="w-12 h-12 text-primary mb-6" />}
                {service.title && <h3 className="text-2xl font-bold mb-4">{service.title}</h3>}
                {service.description && <p className="text-gray-600 mb-6">{service.description}</p>}
                {service.features && service.features.length > 0 && (
                  <ul className="space-y-2">
                    {service.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm text-gray-700">
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
