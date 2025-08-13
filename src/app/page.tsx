// src/app/page.tsx
import Image from 'next/image';

export default function Home() {
  return (
    <main className="min-h-screen bg-white text-gray-900">
      {/*  Navbar */}
      <nav className="flex items-center justify-between p-4 max-w-6xl mx-auto">
        <div className="text-2xl font-bold">ShortPro</div>
        <ul className="hidden sm:flex space-x-6 text-lg">
          <li><a href="/tentang" className="hover:text-blue-600">Tentang</a></li>
          <li><a href="/kontak" className="hover:text-blue-600">Kontak</a></li>
          <li><a href="/berita" className="hover:text-blue-600">Berita</a></li>
          <li><a href="/karir" className="hover:text-blue-600">Karir</a></li>
        </ul>
        <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
          NONTON ONLINE
        </button>
      </nav>

      {/* Hero */}
      <section className="text-center py-16 bg-gray-50">
        <h1 className="text-4xl md:text-5xl font-extrabold mb-4">
          Platform Short Drama Resmi Indonesia
        </h1>
        <p className="text-lg md:text-xl text-gray-700 mb-8">
          ShortPro Indonesia adalah platform streaming drama pendek yang resmi beroperasi di Indonesia dan memiliki ekosistem koin sebagai benefit utama untuk Shortizen.
        </p>
        {/* Drama thumbnails grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-4">
          {['drama1', 'drama2', 'drama3', 'drama4'].map((img) => (
            <Image key={img} src={`/${img}.jpg`} alt={img} width={200} height={300} className="rounded-lg" />
          ))}
        </div>
      </section>

      {/* About Section */}
      <section className="py-16 max-w-4xl mx-auto text-center px-4">
        <h2 className="text-3xl font-semibold mb-4">Tentang ShortPro Indonesia</h2>
        <p className="text-lg mb-4">
          PT. Nextgen Inovasi Digital adalah perseroan terbatas yang resmi berdiri dan beroperasi di Indonesia sejak kuartal pertama 2025. Meskipun tergolong baru, namun tim kami adalah orang-orang yang berpengalaman di bidangnya dan siap memberikan yang terbaik untuk setiap Shortizen!
        </p>
        <a href="/tentang" className="text-blue-600 font-medium hover:underline">
          Selengkapnya
        </a>
      </section>

      {/* Latest News */}
      <section className="py-16 bg-gray-50 px-4">
        <h2 className="text-3xl font-semibold text-center mb-8">Berita Terbaru</h2>
        <div className="max-w-4xl mx-auto grid gap-8">
          {/* News Cards */}
          {[
            {
              title: '5 Tips biar kerja aman, rehat nyaman versi ShortPro',
              date: 'July 10, 2025',
              excerpt: 'Kalian pernah burnout saat kerja...',
              slug: '5-tips-biar-kerja-aman',
            },
            {
              title: '3 Drama di ShortPro yang bikin kamu Geregetan!',
              date: 'July 7, 2025',
              excerpt: 'Halo Shortizen! Kali ini Mimin mau rekomendasi...',
              slug: '3-drama-bikin-geregetan',
            },
          ].map((post) => (
            <article key={post.slug} className="border p-6 rounded-lg bg-white">
              <h3 className="text-xl font-bold mb-2">{post.title}</h3>
              <time className="block text-gray-600 mb-2">{post.date}</time>
              <p className="mb-4">{post.excerpt}</p>
              <a href={`/berita/${post.slug}`} className="text-blue-600 font-medium hover:underline">
                Read More
              </a>
            </article>
          ))}
        </div>
      </section>

      {/* Events Banner */}
      <section className="py-16 text-center">
        <h2 className="text-3xl font-semibold mb-6">Acara Mendatang</h2>
        <Image src="/event-banner.webp" alt="Event Banner" width={800} height={300} className="mx-auto rounded-lg shadow" />
      </section>

      {/* Office Address */}
      <section className="py-16 bg-gray-50 text-center px-4">
        <h2 className="text-3xl font-semibold mb-2">Kunjungi Kami</h2>
        <p>
          Wisma GKBI Lt.37, Jl. Jenderal Sudirman No. 28, Bendungan Hilir, Jakarta Pusat, 10210
        </p>
      </section>

      {/* Footer with social links */}
      <footer className="py-8 text-center border-t">
        <p>© 2025 PT. Nextgen Inovasi Digital</p>
        <div className="flex justify-center space-x-4 mt-4">
          {['tiktok','instagram','facebook','youtube','twitter','linkedin'].map((icon) => (
            <a key={icon} href={`#${icon}`}>
              <Image src={`/icon-${icon}.svg`} alt={icon} width={24} height={24} />
            </a>
          ))}
        </div>
      </footer>
    </main>
  );
}
