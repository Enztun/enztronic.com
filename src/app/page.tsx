import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { ArrowRight, CheckCircle, BarChart } from 'lucide-react';

export default function Home() {
  return (
    <main className="min-h-screen bg-surface selection:bg-primary/10">
      <Navbar />
      
      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <span className="inline-block px-3 py-1 bg-primary/5 text-primary text-sm font-bold rounded-full mb-6">
              PREMIUM DIGITAL AGENCY
            </span>
            <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6">
              Build. Market. <span className="text-primary">Scale.</span>
            </h1>
            <p className="text-lg text-gray-600 mb-10 max-w-lg">
              Web Development, Digital Marketing, Paid Ads & Branding That Drive Real Business Growth. We transform complex technology into high-performing digital assets.
            </p>
            <div className="flex gap-4 flex-wrap">
              <button className="bg-primary text-white px-8 py-4 rounded-lg font-bold hover:shadow-lg transition-all">
                View Services
              </button>
              <button className="border border-gray-300 text-gray-800 px-8 py-4 rounded-lg font-bold hover:bg-gray-50 transition-all">
                Explore Portfolio
              </button>
            </div>
          </div>
          <div className="relative bg-gray-50 rounded-2xl p-8 border border-gray-200">
             <div className="aspect-video bg-white rounded-xl shadow-sm overflow-hidden flex items-center justify-center">
                <BarChart className="w-20 h-20 text-gray-300" />
             </div>
             <div className="absolute -bottom-6 -left-6 bg-white p-6 rounded-xl shadow-xl border border-gray-200">
                <p className="text-3xl font-bold text-primary">+145%</p>
                <p className="text-sm text-gray-500">Revenue Growth</p>
             </div>
          </div>
        </div>
      </section>

      {/* Trust Stats */}
      <section className="py-20 bg-gray-50 border-y border-gray-200">
        <div className="px-6 md:px-12 max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          <div>
            <p className="text-3xl md:text-4xl font-bold">10+ Years</p>
            <p className="text-sm text-gray-500 uppercase tracking-wider mt-2">Industry Expertise</p>
          </div>
          <div>
            <p className="text-3xl md:text-4xl font-bold">450+ Projects</p>
            <p className="text-sm text-gray-500 uppercase tracking-wider mt-2">Successfully Delivered</p>
          </div>
          <div>
            <p className="text-3xl md:text-4xl font-bold">15+ Industries</p>
            <p className="text-sm text-gray-500 uppercase tracking-wider mt-2">Global Market Presence</p>
          </div>
          <div>
             <p className="text-3xl md:text-4xl font-bold">98%</p>
             <p className="text-sm text-gray-500 uppercase tracking-wider mt-2">Client Retention</p>
          </div>
        </div>
      </section>

      {/* Featured Project: Qianlima */}
      <section className="py-24 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="bg-gray-50 rounded-3xl overflow-hidden grid grid-cols-1 lg:grid-cols-2 border border-gray-200">
          <div className="bg-gray-200/50 flex items-center justify-center p-12">
             <div className="w-full h-[400px] bg-white/50 backdrop-blur-sm rounded-xl border border-white flex items-center justify-center text-gray-500 italic">
                Project Screenshot: Qianlima.co.id
             </div>
          </div>
          <div className="p-16 flex flex-col justify-center">
            <span className="text-primary font-bold tracking-widest text-sm mb-4 uppercase">Case Study</span>
            <h2 className="text-3xl md:text-4xl font-bold mb-6">Ongoing Project: Qianlima</h2>
            <p className="text-base text-gray-600 mb-8 leading-relaxed">
              A specialized recruitment platform designed to bridge the gap between Chinese corporations and the Indonesian labor market. This high-performance ecosystem handles complex candidate screening, multilingual communication, and cross-border hiring workflows.
            </p>
            <ul className="space-y-4 mb-10">
              <li className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-primary" />
                <span className="text-base">Multi-language Integration (ID/CN/EN)</span>
              </li>
              <li className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-primary" />
                <span className="text-base">Advanced Candidate Filtering Systems</span>
              </li>
              <li className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-primary" />
                <span className="text-base">Enterprise-grade Security & Compliance</span>
              </li>
            </ul>
            <button className="flex items-center gap-2 text-primary font-bold group">
              View Project Details <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}