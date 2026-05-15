import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

export default function About() {
  return (
    <main className="min-h-screen bg-white">
      <Navbar />
      
      <section className="pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6">About ENZTRONIC</h1>
            <p className="text-lg text-gray-600 mb-6">
              We are a premium digital agency dedicated to transforming businesses through innovative technology and strategic marketing.
            </p>
            <p className="text-lg text-gray-600 mb-8">
              With over 10 years of experience and 450+ successful projects, we've helped companies across 15+ industries achieve remarkable growth through custom web development, digital marketing, and branding solutions.
            </p>
            
            <div className="grid grid-cols-2 gap-6 mt-12">
              <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                <p className="text-3xl font-bold text-primary mb-2">10+</p>
                <p className="text-gray-600">Years of Excellence</p>
              </div>
              <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                <p className="text-3xl font-bold text-primary mb-2">450+</p>
                <p className="text-gray-600">Projects Delivered</p>
              </div>
              <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                <p className="text-3xl font-bold text-primary mb-2">15+</p>
                <p className="text-gray-600">Industries Served</p>
              </div>
              <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                <p className="text-3xl font-bold text-primary mb-2">98%</p>
                <p className="text-gray-600">Client Retention</p>
              </div>
            </div>
          </div>
          
          <div className="bg-gray-100 rounded-3xl p-12 flex items-center justify-center min-h-[500px]">
            <div className="text-center">
              <div className="w-64 h-64 bg-gray-300 rounded-full mx-auto mb-8 flex items-center justify-center">
                <span className="text-gray-500">Founder Portrait</span>
              </div>
              <h3 className="text-2xl font-bold mb-2">Your Name</h3>
              <p className="text-gray-600">Founder & CEO</p>
            </div>
          </div>
        </div>
      </section>
      
      <Footer />
    </main>
  );
}