import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Code, Megaphone, Target, Palette, TrendingUp, Users } from 'lucide-react';

const services = [
  {
    icon: Code,
    title: 'Web Development',
    description: 'Custom websites and web applications built with cutting-edge technologies for optimal performance.',
    features: ['Next.js & React', 'E-commerce Solutions', 'CMS Integration', 'API Development']
  },
  {
    icon: Megaphone,
    title: 'Digital Marketing',
    description: 'Strategic marketing campaigns that increase visibility and drive qualified traffic to your business.',
    features: ['SEO Optimization', 'Content Strategy', 'Social Media Marketing', 'Email Campaigns']
  },
  {
    icon: Target,
    title: 'Paid Advertising',
    description: 'Data-driven ad campaigns across Google, Facebook, and other platforms for maximum ROI.',
    features: ['Google Ads', 'Facebook & Instagram Ads', 'LinkedIn Ads', 'Conversion Tracking']
  },
  {
    icon: Palette,
    title: 'Branding',
    description: 'Complete brand identity design that resonates with your target audience and stands out.',
    features: ['Logo Design', 'Brand Guidelines', 'Visual Identity', 'Brand Strategy']
  },
  {
    icon: TrendingUp,
    title: 'Growth Consulting',
    description: 'Strategic guidance to scale your digital presence and accelerate business growth.',
    features: ['Market Analysis', 'Growth Strategy', 'Performance Analytics', 'Optimization']
  },
  {
    icon: Users,
    title: 'UI/UX Design',
    description: 'User-centered design that creates intuitive and engaging digital experiences.',
    features: ['User Research', 'Wireframing', 'Prototyping', 'Usability Testing']
  }
];

export default function Services() {
  return (
    <main className="min-h-screen bg-white">
      <Navbar />
      
      <section className="pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-6xl font-bold mb-6">Our Services</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Comprehensive digital solutions to help your business thrive in the modern economy.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {services.map((service, index) => (
            <div key={index} className="bg-gray-50 rounded-2xl p-8 border border-gray-200 hover:shadow-lg transition-shadow">
              <service.icon className="w-12 h-12 text-primary mb-6" />
              <h3 className="text-2xl font-bold mb-4">{service.title}</h3>
              <p className="text-gray-600 mb-6">{service.description}</p>
              <ul className="space-y-2">
                {service.features.map((feature, idx) => (
                  <li key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                    <span className="w-2 h-2 bg-primary rounded-full"></span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
      
      <Footer />
    </main>
  );
}