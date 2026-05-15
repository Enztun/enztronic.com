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
        
        <div className="grid gap-8">
          {projects.map((project) => (
            <article key={project.url} className="group overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-50/80 shadow-sm transition hover:shadow-xl">
              <div className="grid gap-6 md:grid-cols-[1.35fr_1fr] p-6">
                <div className="relative overflow-hidden rounded-[2rem] bg-slate-950 p-6 text-white shadow-lg">
                  <div className="absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_52%)]" />
                  <div className="relative rounded-[1.75rem] border border-slate-700/60 bg-slate-900 p-5 shadow-2xl">
                    <div className="flex items-center gap-2 rounded-[1.5rem] border border-slate-700/80 bg-slate-800 px-3 py-2 text-slate-400">
                      <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    </div>
                    <div className="mt-5 rounded-[1.75rem] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6">
                      <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Live preview</div>
                      <h3 className="mt-4 text-3xl font-semibold tracking-tight text-white">{project.title}</h3>
                      <p className="mt-4 text-sm leading-6 text-slate-300 line-clamp-4">{project.description}</p>
                      <div className="mt-6 rounded-3xl border border-slate-700/60 bg-slate-950/75 px-4 py-3 text-xs uppercase tracking-[0.24em] text-slate-400">
                        {project.url}
                      </div>
                    </div>
                  </div>
                  <div className="pointer-events-none absolute -bottom-6 -right-6 hidden md:block">
                    <div className="relative w-36 rounded-[2rem] border border-slate-300/20 bg-white/95 p-3 shadow-[0_28px_60px_-28px_rgba(15,23,42,0.8)]">
                      <div className="mb-3 h-2 w-14 rounded-full bg-slate-300/80" />
                      <div className="h-72 rounded-[1.75rem] bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 p-3">
                        <div className="h-full rounded-[1.5rem] bg-slate-950/95 p-3">
                          <div className="mb-3 h-2.5 w-16 rounded-full bg-slate-700/90" />
                          <div className="space-y-2">
                            <div className="h-3 rounded-full bg-slate-700/90 w-3/4" />
                            <div className="h-3 rounded-full bg-slate-700/90 w-1/2" />
                            <div className="h-3 rounded-full bg-slate-700/90 w-2/3" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col justify-between gap-6">
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
                    <div className="rounded-3xl bg-slate-100 p-4 text-sm text-slate-600">
                      <p className="font-semibold text-slate-900">Device preview included</p>
                      <p className="mt-1 text-slate-500">Phone + laptop placeholder frames make your portfolio feel more visual.</p>
                    </div>
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