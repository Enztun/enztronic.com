'use client';

import { useState } from 'react';

interface ImageWithFallbackProps {
  src: string;
  alt: string;
  className?: string;
}

export default function ImageWithFallback({ src, alt, className }: ImageWithFallbackProps) {
  const [failed, setFailed] = useState(false);

  return (
    <div className={`relative ${className}`}>
      {!failed ? (
        <img
          src={src}
          alt={alt}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
          <div className="text-center p-4">
            <div className="text-4xl mb-2">🖼️</div>
            <p className="text-sm text-slate-500">Screenshot coming soon</p>
          </div>
        </div>
      )}
    </div>
  );
}
