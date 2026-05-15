'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  const toggleMenu = () => setIsOpen(!isOpen);

  return (
    <nav className="fixed top-0 w-full bg-white/40 backdrop-blur-xl z-50 border-b border-white/20">
      <div className="px-6 md:px-12 max-w-7xl mx-auto h-20 flex justify-between items-center">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/logo-transparent.png" alt="ENZTRONIC logo" width={160} height={40} className="object-contain" />
        </Link>
        
        {/* Desktop Menu */}
        <div className="hidden md:flex gap-10 items-center">
          <Link href="/services" className="text-base font-medium text-gray-700 hover:text-primary transition-colors">Services</Link>
          <Link href="/portfolio" className="text-base font-medium text-gray-700 hover:text-primary transition-colors">Portfolio</Link>
          <Link href="/about" className="text-base font-medium text-gray-700 hover:text-primary transition-colors">About</Link>
          <Link href="/blog" className="text-base font-medium text-gray-700 hover:text-primary transition-colors">Blog</Link>
          <a href="mailto:enztun@enztronic.com" className="bg-primary text-white px-6 py-2.5 rounded-md text-base font-bold hover:opacity-90 transition-opacity">
            Get Started
          </a>
        </div>

        {/* Mobile Menu Button */}
        <button 
          onClick={toggleMenu}
          className="md:hidden p-2 rounded-lg hover:bg-white/20 transition-colors"
          aria-label="Toggle menu"
        >
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden bg-white/50 backdrop-blur-xl border-t border-white/20">
          <div className="px-6 py-4 space-y-4">
            <Link 
              href="/services" 
              className="block text-gray-700 hover:text-primary transition-colors font-medium"
              onClick={() => setIsOpen(false)}
            >
              Services
            </Link>
            <Link 
              href="/portfolio" 
              className="block text-gray-700 hover:text-primary transition-colors font-medium"
              onClick={() => setIsOpen(false)}
            >
              Portfolio
            </Link>
            <Link 
              href="/about" 
              className="block text-gray-700 hover:text-primary transition-colors font-medium"
              onClick={() => setIsOpen(false)}
            >
              About
            </Link>
            <Link 
              href="/blog" 
              className="block text-gray-700 hover:text-primary transition-colors font-medium"
              onClick={() => setIsOpen(false)}
            >
              Blog
            </Link>
            <a 
              href="mailto:enztun@enztronic.com"
              className="block bg-primary text-white px-6 py-2.5 rounded-md text-base font-bold hover:opacity-90 transition-opacity text-center"
              onClick={() => setIsOpen(false)}
            >
              Get Started
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}