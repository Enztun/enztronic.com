'use client';

import { useEffect, useRef } from 'react';

interface ImageWithFallbackProps {
  src: string;
  alt: string;
  className?: string;
}

export default function ImageWithFallback({ src, alt, className }: ImageWithFallbackProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleError = () => {
      if (imgRef.current) {
        imgRef.current.style.display = 'none';
      }

      if (containerRef.current && !containerRef.current.querySelector('.placeholder')) {
        const placeholder = document.createElement('div');
        placeholder.className =
          'placeholder absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200';
        placeholder.innerHTML = `
          <div class="text-center p-4">
            <div class="text-4xl mb-2">🖼️</div>
            <p class="text-sm text-slate-500">Screenshot coming soon</p>
          </div>
        `;
        containerRef.current.appendChild(placeholder);
      }
    };

    const img = imgRef.current;
    if (img) {
      img.addEventListener('error', handleError);
      return () => {
        img.removeEventListener('error', handleError);
      };
    }
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <img 
        ref={imgRef}
        src={src} 
        alt={alt}
        className="w-full h-full object-cover"
      />
    </div>
  );
}
