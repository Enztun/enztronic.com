import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-white py-16">
      <div className="px-6 md:px-12 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          <div>
            <h3 className="text-2xl font-bold mb-4">ENZTRONIC</h3>
            <p className="text-gray-400 text-sm">
              Building digital excellence for businesses worldwide.
            </p>
          </div>
          
          <div>
            <h4 className="font-bold mb-4">Services</h4>
            <ul className="space-y-2 text-gray-400 text-sm">
              <li><Link href="/services" className="hover:text-primary transition-colors">Web Development</Link></li>
              <li><Link href="/services" className="hover:text-primary transition-colors">Digital Marketing</Link></li>
              <li><Link href="/services" className="hover:text-primary transition-colors">Paid Ads</Link></li>
              <li><Link href="/services" className="hover:text-primary transition-colors">Branding</Link></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-bold mb-4">Company</h4>
            <ul className="space-y-2 text-gray-400 text-sm">
              <li><Link href="/about" className="hover:text-primary transition-colors">About Us</Link></li>
              <li><Link href="/portfolio" className="hover:text-primary transition-colors">Portfolio</Link></li>
              <li><Link href="/blog" className="hover:text-primary transition-colors">Blog</Link></li>
              <li><Link href="/contact" className="hover:text-primary transition-colors">Contact</Link></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-bold mb-4">Connect</h4>
            <ul className="space-y-2 text-gray-400 text-sm">
              <li><a href="#" className="hover:text-primary transition-colors">LinkedIn</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">Twitter</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">Instagram</a></li>
            </ul>
          </div>
        </div>
        
        <div className="border-t border-gray-800 mt-12 pt-8 text-center text-gray-400 text-sm">
          <p>&copy; {new Date().getFullYear()} ENZTRONIC. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}