import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-white">
      <Navbar />
      <section className="pt-32 pb-24 px-6 md:px-12 max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-sm uppercase tracking-[0.3em] text-primary font-bold">Get in touch</p>
          <h1 className="text-4xl md:text-5xl font-bold mt-5">Contact ENZTRONIC</h1>
          <p className="mt-6 text-gray-600 max-w-2xl mx-auto">
            Ready to start your project? Send us a message and we’ll reach out with a tailored digital strategy.
          </p>
        </div>
        <div className="rounded-3xl border border-gray-200 bg-gray-50 p-10">
          <p className="text-gray-700 text-lg mb-6">Email us at <a href="mailto:enztun@enztronic.com" className="text-primary underline">enztun@enztronic.com</a> or use the contact form once the site is fully built.</p>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-200">
              <p className="font-semibold mb-2">Office</p>
              <p className="text-gray-600">Jakarta, Indonesia</p>
            </div>
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-200">
              <p className="font-semibold mb-2">Phone</p>
              <p className="text-gray-600">+62 812 3456 7890</p>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
