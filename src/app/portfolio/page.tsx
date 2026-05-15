import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { ArrowRight } from 'lucide-react';

const projects = [
  {
    title: 'Qianlima',
    category: 'Recruitment Platform',
    description: 'Cross-border hiring platform connecting Chinese corporations with Indonesian talent. Features multi-language support (ID/CN/EN), advanced candidate filtering, enterprise-grade security, and a comprehensive HR workflow management system.',
    url: 'https://qianlima.co.id',
    tags: ['Next.js', 'Multi-language', 'Enterprise'],
    laptopScreenshot: '/screenshots/qianlima-laptop.png',
    mobileScreenshot: '/screenshots/qianlima-mobile.png'
  },
  {
    title: 'Monopole Consulting',
    category: 'Wine Consulting - Bilingual',
    description: 'Fine and rare wine consultation services website designed for both Taiwanese and US clients. Bilingual interface (English/Traditional Chinese), wine list catalog, consulting services, events management, and tasting notes - developed from scratch with client branding.',
    url: 'https://monopoleconsulting.com',
    tags: ['Bilingual', 'React', 'E-commerce'],
    laptopScreenshot: '/screenshots/monopoleconsulting-laptop.png',
    mobileScreenshot: '/screenshots/monopoleconsulting-mobile.png'
  },
  {
    title: 'Setia Karya (AC Mobil Murah)',
    category: 'Full Digital Marketing',
    description: 'Complete brand transformation and digital marketing campaign. Created the iconic brand jargon "Car, Bus, Truck & Heavy Equipment Air Conditioning Service". Built website, implemented Google Ads strategy, and managed social media channels including YouTube, Instagram, and Facebook.',
    url: 'https://acmobilmurah.com',
    tags: ['Branding', 'Google Ads', 'Social Media'],
    laptopScreenshot: '/screenshots/acmobilmurah-laptop.png',
    mobileScreenshot: '/screenshots/acmobilmurah-mobile.png'
  },
  {
    title: 'Berdi Rental',
    category: 'Car Rental - SEO Ranked #1',
    description: 'Car rental landing page that achieved SEO ranking #1 in just 1 week. Built brand identity from scratch with strategic SEO optimization, creating a high-performing website that immediately captured organic search traffic.',
    url: 'https://berdirental.com',
    tags: ['SEO', 'Landing Page', 'Branding'],
    laptopScreenshot: '/screenshots/berdirental-laptop.png',
    mobileScreenshot: '/screenshots/berdirental-mobile.png'
  },
  {
    title: 'ShortPro',
    category: 'Local Branding & Digital Environment',
    description: 'Complete digital ecosystem setup including website development, FTP infrastructure, email domain configuration, and content production. Managed official Instagram presence, paid advertising, and ongoing digital events for local market establishment.',
    url: 'https://shortpro.co.id',
    tags: ['Branding', 'Infrastructure', 'Content'],
    laptopScreenshot: '/screenshots/shortpro-laptop.png',
    mobileScreenshot: '/screenshots/shortpro-mobile.png'
  },
  {
    title: 'Salim Berkat Sejahtera',
    category: 'PT Branding & Web Presence',
    description: 'Website and email domain setup for PT. Salim Berkat Sejahtera in Balikpapan, Kalimantan Timur. Focused on establishing professional online presence and brand identity for the company.',
    url: 'https://salimberkatsejahtera.com',
    tags: ['Branding', 'Web Design', 'Email'],
    laptopScreenshot: '/screenshots/salimberkatsejahtera-laptop.png',
    mobileScreenshot: '/screenshots/salimberkatsejahtera-mobile.png'
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
        
        <div className="grid gap-8">
          {projects.map((project) => (
            <article key={project.url} className="group overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-50/80 shadow-sm transition hover:shadow-xl">
              <div className="grid gap-6 md:grid-cols-[1fr_0.8fr] p-6">
                {/* Laptop Mockup */}
                <div className="relative flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl p-8 min-h-[400px]">
                  <div className="relative w-full max-w-lg">
                    {/* Laptop screen frame */}
                    <div className="relative rounded-xl bg-slate-900 p-2 shadow-2xl">
                      {/* Top bar with camera */}
                      <div className="absolute left-1/2 top-0 h-3 w-20 -translate-x-1/2 -translate-y-1/2 rounded-b-lg bg-slate-800 z-10">
                        <div className="mx-auto mt-1.5 h-1.5 w-1.5 rounded-full bg-slate-700"></div>
                      </div>
                      {/* Screen bezel */}
                      <div className="rounded-lg bg-slate-800 p-1">
                        {/* Actual screen area */}
                        <div className="overflow-hidden rounded-md bg-white aspect-video relative">
                          <ImageWithFallback 
                            src={project.laptopScreenshot} 
                            alt={`${project.title} laptop preview`}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      </div>
                    </div>
                    {/* Laptop base */}
                    <div className="mt-0 h-3 bg-gradient-to-b from-slate-400 to-slate-500 rounded-b-xl shadow-lg"></div>
                    <div className="h-1 bg-slate-600 rounded-b-lg"></div>
                  </div>
                </div>

                {/* Mobile Mockup */}
                <div className="relative flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl p-8">
                  <div className="relative">
                    {/* iPhone frame */}
                    <div className="relative w-[280px] h-[560px] bg-slate-900 rounded-[3rem] p-3 shadow-2xl border-4 border-slate-800">
                      {/* Dynamic Island / Notch */}
                      <div className="absolute left-1/2 top-3 h-7 w-28 -translate-x-1/2 bg-black rounded-full z-10"></div>
                      {/* Phone screen */}
                      <div className="h-full w-full rounded-[2.5rem] bg-white overflow-hidden relative">
                        <ImageWithFallback 
                          src={project.mobileScreenshot} 
                          alt={`${project.title} mobile preview`}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      {/* Side buttons */}
                      <div className="absolute left-0 top-20 h-8 w-1 bg-slate-700 rounded-l"></div>
                      <div className="absolute left-0 top-32 h-12 w-1 bg-slate-700 rounded-l"></div>
                      <div className="absolute right-0 top-28 h-16 w-1 bg-slate-700 rounded-r"></div>
                    </div>
                  </div>
                </div>

                <div className="md:col-span-2 flex flex-col justify-between gap-6 pt-4">
                  <div className="space-y-5">
                    <span className="inline-flex rounded-full bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">{project.category}</span>
                    <div className="space-y-3">
                      <p className="text-gray-700">{project.description}</p>
                      <div className="flex flex-wrap gap-2">
                        {project.tags.map((tag, idx) => (
                          <span key={idx} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <a
                      href={project.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
                    >
                      Visit Site <ArrowRight className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
      
      <Footer />
    </main>
  );
}

// Component to handle image with fallback to placeholder
function ImageWithFallback({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <img 
        src={src} 
        alt={alt}
        className="w-full h-full object-cover"
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          target.style.display = 'none';
          const parent = target.parentElement;
          if (parent && !parent.querySelector('.placeholder')) {
            const placeholder = document.createElement('div');
            placeholder.className = 'placeholder absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200';
            placeholder.innerHTML = `
              <div class="text-center p-4">
                <div class="text-4xl mb-2">🖼️</div>
                <p class="text-sm text-slate-500">Screenshot coming soon</p>
              </div>
            `;
            parent.appendChild(placeholder);
          }
        }}
      />
    </div>
  );
}
