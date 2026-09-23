import { notFound } from 'next/navigation';

/** Keep stale and unknown public links inside the localized recovery shell. */
export default function MissingPage() {
  notFound();
}
