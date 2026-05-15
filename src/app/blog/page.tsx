import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

export default function BlogPage() {
  return (
    <main className="min-h-screen bg-white">
      <Navbar />
      <section className="pt-32 pb-24 px-6 md:px-12 max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-sm uppercase tracking-[0.4em] text-primary font-bold">Insights</p>
          <h1 className="text-4xl md:text-5xl font-bold mt-5">Latest news from ENZTRONIC</h1>
          <p className="mt-6 text-gray-600 max-w-2xl mx-auto">
            Articles, case studies, and agency updates for digital transformation, web development, and growth marketing.
          </p>
        </div>
        <div className="grid gap-8">
          <div className="rounded-3xl border border-gray-200 p-8 bg-gray-50">
            <p className="text-sm text-gray-500 uppercase tracking-[0.2em] mb-3">Coming soon</p>
            <h2 className="text-2xl font-semibold mb-4">Blog content is under construction</h2>
            <p className="text-gray-600">
              We’re preparing high-quality stories about digital products, branding, and successful campaigns. Check back soon.
            </p>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
