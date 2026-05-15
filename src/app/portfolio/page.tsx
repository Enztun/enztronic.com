import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { ArrowRight } from 'lucide-react';

const projects = [
  {
    title: 'Qianlima',
    category: 'Recruitment Platform',
    description: 'Cross-border hiring platform connecting Chinese corporations with Indonesian talent. Features multi-language support (ID/CN/EN), advanced candidate filtering, enterprise-grade security, and a comprehensive HR workflow management system.',
    url: 'https://qianlima.co.id',
    tags: ['Next.js', 'Multi-language', 'Enterprise']
  },
  {
    title: 'Monopole Consulting',
    category: 'Wine Consulting - Bilingual',
    description: 'Fine and rare wine consultation services website designed for both Taiwanese and US clients. Bilingual interface (English/Traditional Chinese), wine list catalog, consulting services, events management, and tasting notes - developed from scratch with client branding.',
    url: 'https://monopoleconsulting.com',
    tags: ['Bilingual', 'React', 'E-commerce']
  },
  {
    title: 'Setia Karya (AC Mobil Murah)',
    category: 'Full Digital Marketing',
    description: 'Complete brand transformation and digital marketing campaign. Created the iconic brand jargon "Car, Bus, Truck & Heavy Equipment Air Conditioning Service". Built website, implemented Google Ads strategy, and managed social media channels including YouTube, Instagram, and Facebook.',
    url: 'https://acmobilmurah.com',
    tags: ['Branding', 'Google Ads', 'Social Media']
  },
  {
    title: 'Berdi Rental',
    category: 'Car Rental - SEO Ranked #1',
    description: 'Car rental landing page that achieved SEO ranking #1 in just 1 week. Built brand identity from scratch with strategic SEO optimization, creating a high-performing website that immediately captured organic search traffic.',
    url: 'https://berdirental.com',
    tags: ['SEO', 'Landing Page', 'Branding']
  },
  {
    title: 'ShortPro',
    category: 'Local Branding & Digital Environment',
    description: 'Complete digital ecosystem setup including website development, FTP infrastructure, email domain configuration, and content production. Managed official Instagram presence, paid advertising, and ongoing digital events for local market establishment.',
    url: 'https://shortpro.co.id',
    tags: ['Branding', 'Infrastructure', 'Content']
  },
  {
    title: 'Salim Berkat Sejahtera',
    category: 'PT Branding & Web Presence',
    description: 'Website and email domain setup for PT. Salim Berkat Sejahtera in Balikpapan, Kalimantan Timur. Focused on establishing professional online presence and brand identity for the company.',
    url: 'https://salimberkatsejahtera.com',
    tags: ['Branding', 'Web Design', 'Email']
  }
];

export default function Portfolio() {
  return (
    <main className="min-h-screen bg-white">
      <Navbar />
      
      <section className="pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-6xl font-bold mb-6">Our Portfolio</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Successful projects across recruitment, consulting, digital marketing, and e-commerce. From brand creation to SEO dominance.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {projects.map((project, index) => (
            <div key={index} className="group bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl overflow-hidden border border-gray-200 hover:shadow-xl transition-all hover:border-primary/30">
              <div className="aspect-video bg-gradient-to-br from-primary/10 to-blue-50 flex items-center justify-center p-6">
                <div className="text-center">
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">{project.title}</h3>
                  <p className="text-sm text-gray-600">{project.category}</p>
                </div>
              </div>
              <div className="p-6">
                <p className="text-gray-700 mb-4 line-clamp-3">{project.description}</p>
                <div className="flex flex-wrap gap-2 mb-6">
                  {project.tags.map((tag, idx) => (
                    <span key={idx} className="px-3 py-1 bg-white border border-gray-200 rounded-full text-xs font-medium text-gray-700">
                      {tag}
                    </span>
                  ))}
                </div>
                <a 
                  href={project.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-primary font-bold group-hover:gap-3 transition-all hover:text-blue-700"
                >
                  Visit Site <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>
      
      <Footer />
    </main>
  );
}