'use client';

import { useState } from 'react';
import { Link2, Check } from 'lucide-react';

const FacebookSVG = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </svg>
);

const LinkedInSVG = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);

const XSVG = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

interface ShareButtonsProps {
  url: string;
  title: string;
  label: string;
}

export function ShareButtons({ url, title, label }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  const encoded = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);

  const socials = [
    {
      Icon: FacebookSVG,
      name: 'Facebook',
      href: `https://www.facebook.com/sharer/sharer.php?u=${encoded}`,
    },
    {
      Icon: LinkedInSVG,
      name: 'LinkedIn',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`,
    },
    {
      Icon: XSVG,
      name: 'Twitter / X',
      href: `https://twitter.com/intent/tweet?url=${encoded}&text=${encodedTitle}`,
    },
  ];

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  }

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">{label}</p>
      <div className="flex gap-2">
        {socials.map(({ Icon, name, href }) => (
          <a
            key={name}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Share on ${name}`}
            className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center text-gray-500 hover:border-primary hover:text-primary transition-colors"
          >
            <Icon />
          </a>
        ))}
        <button
          onClick={copyLink}
          aria-label="Copy link"
          className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center text-gray-500 hover:border-primary hover:text-primary transition-colors"
        >
          {copied ? (
            <Check className="w-4 h-4 text-green-500" />
          ) : (
            <Link2 className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}
