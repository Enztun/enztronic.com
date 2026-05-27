import { createClient } from '@sanity/client';
import { config } from 'dotenv';
import { randomUUID } from 'crypto';

config({ path: '.env.local' });

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
});

const key = () => randomUUID().replace(/-/g, '').slice(0, 12);

// ---------------------------------------------------------------------------
// EN pages
// ---------------------------------------------------------------------------

const homeEN = {
  _type: 'page',
  title: 'Home',
  slug: { _type: 'slug', current: 'home' },
  language: 'en',
  modules: [
    {
      _type: 'module.hero',
      _key: key(),
      badge: 'GLOBAL QUALITY · BUILT IN JAKARTA',
      headline: 'Launch. Rank.',
      headlineHighlight: 'Scale.',
      description: 'One team. Full digital stack. We handle web development, SEO, paid ads, and branding — so you can focus on building your business. Jakarta-based, globally delivered, at a fraction of Western agency costs.',
      ctaPrimaryText: 'Start Your Project',
      ctaPrimaryHref: '/contact',
      ctaSecondaryText: 'See Our Work',
      ctaSecondaryHref: '/portfolio',
      revenueGrowth: '+145%',
      revenueLabel: 'Average Revenue Growth',
    },
    {
      _type: 'module.stats',
      _key: key(),
      items: [
        { _key: key(), value: '10+ Years', label: 'Industry Experience' },
        { _key: key(), value: '450+ Projects', label: 'Successfully Delivered' },
        { _key: key(), value: '15+ Industries', label: 'Clients Worldwide' },
        { _key: key(), value: '98%', label: 'Client Retention Rate' },
      ],
    },
    {
      _type: 'module.caseStudy',
      _key: key(),
      label: 'Featured Project',
      title: 'Qianlima — Cross-Border Hiring at Scale',
      description: 'Built from scratch for Chinese corporations recruiting Indonesian talent. A multi-language recruitment platform handling complex candidate screening, cross-border HR workflows, and enterprise-grade compliance — live and growing.',
      features: [
        'Multi-language interface (ID / CN / EN)',
        'Advanced candidate screening & filtering',
        'Enterprise security & compliance built-in',
      ],
      ctaText: 'View Project',
      ctaHref: 'https://qianlima.co.id',
    },
  ],
};

const aboutEN = {
  _type: 'page',
  title: 'About',
  slug: { _type: 'slug', current: 'about' },
  language: 'en',
  modules: [
    {
      _type: 'module.aboutIntro',
      _key: key(),
      heading: 'We build digital infrastructure for serious businesses.',
      paragraphs: [
        'Enztronic is a full-stack digital agency based in Jakarta, Indonesia. We work with startups, founders, and growing businesses that need a complete digital team — not a patchwork of vendors.',
        'We combine engineering, SEO, paid advertising, and branding into one coherent operation. No handoffs between agencies. No lost context. Just execution — delivered globally at a fraction of Western rates.',
      ],
      stats: [
        { _key: key(), value: '10+', label: 'Years of Experience' },
        { _key: key(), value: '450+', label: 'Projects Delivered' },
        { _key: key(), value: '15+', label: 'Industries Covered' },
        { _key: key(), value: '98%', label: 'Client Retention Rate' },
      ],
      founder: { name: 'Aaron', role: 'Founder & CEO' },
    },
  ],
};

const servicesEN = {
  _type: 'page',
  title: 'Services',
  slug: { _type: 'slug', current: 'services' },
  language: 'en',
  modules: [
    {
      _type: 'module.servicesGrid',
      _key: key(),
      heading: 'What We Do',
      subheading: 'Everything a startup needs to launch, get found, and grow — under one roof.',
      services: [
        { _key: key(), title: 'Web Development', description: 'Fast, scalable websites and apps built to convert — not just look good. We ship in weeks, not months.', icon: 'Code', features: ['Next.js & React', 'E-commerce & Marketplaces', 'CMS Integration', 'API Development'] },
        { _key: key(), title: 'SEO & Content', description: 'Rank on Google before your runway runs out. We build search presence that compounds over time.', icon: 'Megaphone', features: ['Technical SEO', 'Content Strategy', 'On-page Optimization', 'Link Building'] },
        { _key: key(), title: 'Paid Advertising', description: 'Ad spend that actually returns. We run performance campaigns with tight tracking from day one.', icon: 'Target', features: ['Google Ads', 'Meta (Facebook & Instagram)', 'LinkedIn Ads', 'Conversion Tracking'] },
        { _key: key(), title: 'Branding', description: 'A brand that looks serious from launch day. Logo, identity, and guidelines built to scale with you.', icon: 'Palette', features: ['Logo Design', 'Brand Guidelines', 'Visual Identity', 'Brand Strategy'] },
        { _key: key(), title: 'Growth Consulting', description: 'Strategy first, execution second. We help founders prioritize what actually moves the needle.', icon: 'TrendingUp', features: ['Market Analysis', 'Channel Strategy', 'Performance Analytics', 'Roadmap Planning'] },
        { _key: key(), title: 'UI/UX Design', description: 'Interfaces that users actually understand. Research-backed design that reduces churn and increases conversions.', icon: 'Users', features: ['User Research', 'Wireframing & Flows', 'Prototyping', 'Usability Testing'] },
      ],
    },
  ],
};

const portfolioEN = {
  _type: 'page',
  title: 'Portfolio',
  slug: { _type: 'slug', current: 'portfolio' },
  language: 'en',
  modules: [
    {
      _type: 'module.portfolioGrid',
      _key: key(),
      heading: 'Our Portfolio',
      description: 'Successful projects across recruitment, consulting, digital marketing, and e-commerce. From brand creation to SEO dominance.',
      visitSiteLabel: 'Visit Site',
      projects: [
        { _key: key(), title: 'Qianlima', category: 'Recruitment Platform', description: 'Cross-border hiring platform connecting Chinese corporations with Indonesian talent. Features multi-language support (ID/CN/EN), advanced candidate filtering, enterprise-grade security, and a comprehensive HR workflow management system.', url: 'https://qianlima.co.id', tags: ['Next.js', 'Multi-language', 'Enterprise'] },
        { _key: key(), title: 'Monopole Consulting', category: 'Wine Consulting - Bilingual', description: 'Fine and rare wine consultation services website designed for both Taiwanese and US clients. Bilingual interface (English/Traditional Chinese), wine list catalog, consulting services, events management, and tasting notes - developed from scratch with client branding.', url: 'https://monopoleconsulting.com', tags: ['Bilingual', 'React', 'E-commerce'] },
        { _key: key(), title: 'Setia Karya (AC Mobil Murah)', category: 'Full Digital Marketing', description: 'Complete brand transformation and digital marketing campaign. Created the iconic brand jargon "Car, Bus, Truck & Heavy Equipment Air Conditioning Service". Built website, implemented Google Ads strategy, and managed social media channels including YouTube, Instagram, and Facebook.', url: 'https://acmobilmurah.com', tags: ['Branding', 'Google Ads', 'Social Media'] },
        { _key: key(), title: 'Berdi Rental', category: 'Car Rental - SEO Ranked #1', description: 'Car rental landing page that achieved SEO ranking #1 in just 1 week. Built brand identity from scratch with strategic SEO optimization, creating a high-performing website that immediately captured organic search traffic.', url: 'https://berdirental.com', tags: ['SEO', 'Landing Page', 'Branding'] },
        { _key: key(), title: 'ShortPro', category: 'Local Branding & Digital Environment', description: 'Complete digital ecosystem setup including website development, FTP infrastructure, email domain configuration, and content production. Managed official Instagram presence, paid advertising, and ongoing digital events for local market establishment.', url: 'https://shortpro.co.id', tags: ['Branding', 'Infrastructure', 'Content'] },
        { _key: key(), title: 'Salim Berkat Sejahtera', category: 'PT Branding & Web Presence', description: 'Website and email domain setup for PT. Salim Berkat Sejahtera in Balikpapan, Kalimantan Timur. Focused on establishing professional online presence and brand identity for the company.', url: 'https://salimberkatsejahtera.com', tags: ['Branding', 'Web Design', 'Email'] },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// ID pages (same structure, Indonesian content)
// ---------------------------------------------------------------------------

const homeID = {
  ...homeEN,
  language: 'id',
  modules: [
    {
      ...homeEN.modules[0],
      _key: key(),
      badge: 'KUALITAS GLOBAL · DIBUAT DI JAKARTA',
      headline: 'Bangun. Rangking.',
      headlineHighlight: 'Berkembang.',
      description: 'Satu tim. Layanan digital lengkap. Kami menangani pengembangan web, SEO, iklan berbayar, dan branding — sehingga Anda bisa fokus membangun bisnis. Berbasis di Jakarta, dikirim secara global, dengan biaya jauh lebih rendah dari agensi Barat.',
      ctaPrimaryText: 'Mulai Proyek Anda',
      ctaSecondaryText: 'Lihat Karya Kami',
      revenueLabel: 'Rata-rata Pertumbuhan Pendapatan',
    },
    {
      ...homeEN.modules[1],
      _key: key(),
      items: [
        { _key: key(), value: '10+ Tahun', label: 'Pengalaman Industri' },
        { _key: key(), value: '450+ Proyek', label: 'Berhasil Diselesaikan' },
        { _key: key(), value: '15+ Industri', label: 'Klien di Seluruh Dunia' },
        { _key: key(), value: '98%', label: 'Tingkat Retensi Klien' },
      ],
    },
    {
      ...homeEN.modules[2],
      _key: key(),
      label: 'Proyek Unggulan',
      description: 'Dibangun dari nol untuk korporasi Tiongkok yang merekrut talenta Indonesia. Platform rekrutmen multi-bahasa yang menangani penyaringan kandidat yang kompleks, alur kerja HR lintas batas, dan kepatuhan kelas enterprise — aktif dan berkembang.',
      features: [
        'Antarmuka multi-bahasa (ID / CN / EN)',
        'Penyaringan kandidat tingkat lanjut',
        'Keamanan & kepatuhan enterprise',
      ],
      ctaText: 'Lihat Proyek',
    },
  ],
};

const aboutID = {
  ...aboutEN,
  language: 'id',
  modules: [
    {
      ...aboutEN.modules[0],
      _key: key(),
      heading: 'Kami membangun infrastruktur digital untuk bisnis serius.',
      paragraphs: [
        'Enztronic adalah agensi digital full-stack yang berbasis di Jakarta, Indonesia. Kami bekerja dengan startup, founder, dan bisnis yang sedang berkembang yang membutuhkan tim digital lengkap — bukan kumpulan vendor yang terpisah-pisah.',
        'Kami menggabungkan engineering, SEO, iklan berbayar, dan branding dalam satu operasi yang koheren. Tidak ada serah terima antar agensi. Tidak ada konteks yang hilang. Hanya eksekusi — dikirim secara global dengan biaya jauh lebih rendah dari tarif Barat.',
      ],
      stats: [
        { _key: key(), value: '10+', label: 'Tahun Pengalaman' },
        { _key: key(), value: '450+', label: 'Proyek Diselesaikan' },
        { _key: key(), value: '15+', label: 'Industri Tercakup' },
        { _key: key(), value: '98%', label: 'Tingkat Retensi Klien' },
      ],
    },
  ],
};

const servicesID = {
  ...servicesEN,
  language: 'id',
  modules: [
    {
      ...servicesEN.modules[0],
      _key: key(),
      heading: 'Layanan Kami',
      subheading: 'Semua yang dibutuhkan startup untuk diluncurkan, ditemukan, dan berkembang — dalam satu atap.',
      services: [
        { _key: key(), title: 'Pengembangan Web', description: 'Website dan aplikasi yang cepat dan skalabel untuk konversi — bukan sekadar tampilan. Kami merilis dalam hitungan minggu, bukan bulan.', icon: 'Code', features: ['Next.js & React', 'E-commerce & Marketplace', 'Integrasi CMS', 'Pengembangan API'] },
        { _key: key(), title: 'SEO & Konten', description: 'Rangking di Google sebelum runway Anda habis. Kami membangun kehadiran pencarian yang terus berkembang.', icon: 'Megaphone', features: ['Technical SEO', 'Strategi Konten', 'Optimasi On-page', 'Link Building'] },
        { _key: key(), title: 'Iklan Berbayar', description: 'Pengeluaran iklan yang benar-benar menghasilkan. Kami menjalankan kampanye performa dengan pelacakan ketat dari hari pertama.', icon: 'Target', features: ['Google Ads', 'Meta (Facebook & Instagram)', 'LinkedIn Ads', 'Pelacakan Konversi'] },
        { _key: key(), title: 'Branding', description: 'Brand yang terlihat serius sejak hari peluncuran. Logo, identitas, dan panduan yang dibangun untuk berkembang bersama Anda.', icon: 'Palette', features: ['Desain Logo', 'Panduan Brand', 'Identitas Visual', 'Strategi Brand'] },
        { _key: key(), title: 'Konsultasi Pertumbuhan', description: 'Strategi dulu, eksekusi kemudian. Kami membantu founder memprioritaskan apa yang benar-benar menggerakkan jarum.', icon: 'TrendingUp', features: ['Analisis Pasar', 'Strategi Saluran', 'Analitik Performa', 'Perencanaan Roadmap'] },
        { _key: key(), title: 'Desain UI/UX', description: 'Antarmuka yang benar-benar dipahami pengguna. Desain berbasis riset yang mengurangi churn dan meningkatkan konversi.', icon: 'Users', features: ['Riset Pengguna', 'Wireframing & Alur', 'Prototyping', 'Pengujian Kegunaan'] },
      ],
    },
  ],
};

const portfolioID = {
  ...portfolioEN,
  language: 'id',
  modules: [
    {
      ...portfolioEN.modules[0],
      _key: key(),
      heading: 'Portofolio Kami',
      description: 'Proyek sukses di bidang rekrutmen, konsultasi, pemasaran digital, dan e-commerce. Dari pembuatan brand hingga dominasi SEO.',
      visitSiteLabel: 'Kunjungi Situs',
    },
  ],
};

// ---------------------------------------------------------------------------
// ZH pages
// ---------------------------------------------------------------------------

const homeZH = {
  ...homeEN,
  language: 'zh',
  modules: [
    {
      ...homeEN.modules[0],
      _key: key(),
      badge: '全球品质·雅加达制造',
      headline: '启动。排名。',
      headlineHighlight: '规模化。',
      description: '一支团队，完整数字服务栈。我们处理网站开发、SEO、付费广告和品牌策划——让您专注于业务增长。雅加达出品，全球交付，成本远低于西方机构。',
      ctaPrimaryText: '开始您的项目',
      ctaSecondaryText: '查看我们的作品',
      revenueLabel: '平均营收增长',
    },
    {
      ...homeEN.modules[1],
      _key: key(),
      items: [
        { _key: key(), value: '10年以上', label: '行业经验' },
        { _key: key(), value: '450+项目', label: '成功交付' },
        { _key: key(), value: '15+行业', label: '全球客户' },
        { _key: key(), value: '98%', label: '客户留存率' },
      ],
    },
    {
      ...homeEN.modules[2],
      _key: key(),
      label: '精选项目',
      description: '从零开始为中国企业招募印度尼西亚人才而打造。一个多语言招聘平台，处理复杂的候选人筛选、跨境HR工作流程和企业级合规要求——已上线并持续增长。',
      features: [
        '多语言界面（印尼语/中文/英文）',
        '高级候选人筛选与过滤',
        '企业级安全与合规',
      ],
      ctaText: '查看项目',
    },
  ],
};

const aboutZH = {
  ...aboutEN,
  language: 'zh',
  modules: [
    {
      ...aboutEN.modules[0],
      _key: key(),
      heading: '我们为严肃的企业构建数字基础设施。',
      paragraphs: [
        'Enztronic是一家总部位于印度尼西亚雅加达的全栈数字机构。我们与需要完整数字团队的初创企业、创始人和成长中的企业合作——而不是东拼西凑的供应商。',
        '我们将工程、SEO、付费广告和品牌策划整合为一个统一的运营体系。没有机构间的交接。没有上下文丢失。只有执行——以远低于西方价格的成本在全球交付。',
      ],
      stats: [
        { _key: key(), value: '10年以上', label: '丰富经验' },
        { _key: key(), value: '450+', label: '项目交付' },
        { _key: key(), value: '15+', label: '覆盖行业' },
        { _key: key(), value: '98%', label: '客户留存率' },
      ],
    },
  ],
};

const servicesZH = {
  ...servicesEN,
  language: 'zh',
  modules: [
    {
      ...servicesEN.modules[0],
      _key: key(),
      heading: '我们的服务',
      subheading: '初创企业启动、被发现和增长所需的一切——一站式服务。',
      services: [
        { _key: key(), title: '网站开发', description: '快速、可扩展的网站和应用程序，专为转化而构建——不仅仅是好看。我们在数周内交付，而非数月。', icon: 'Code', features: ['Next.js & React', '电商与市场平台', 'CMS集成', 'API开发'] },
        { _key: key(), title: 'SEO与内容', description: '在资金耗尽前在谷歌上排名。我们构建随时间复利增长的搜索影响力。', icon: 'Megaphone', features: ['技术SEO', '内容策略', '页面优化', '链接建设'] },
        { _key: key(), title: '付费广告', description: '真正有回报的广告支出。我们从第一天起就进行严格跟踪的效果营销活动。', icon: 'Target', features: ['谷歌广告', 'Meta（Facebook和Instagram）', 'LinkedIn广告', '转化追踪'] },
        { _key: key(), title: '品牌策划', description: '从上线第一天就看起来专业的品牌。Logo、视觉识别系统和规范，随您一起扩展。', icon: 'Palette', features: ['Logo设计', '品牌规范', '视觉识别', '品牌战略'] },
        { _key: key(), title: '增长咨询', description: '先有战略，再有执行。我们帮助创始人优先考虑真正推动指标的事情。', icon: 'TrendingUp', features: ['市场分析', '渠道策略', '效果分析', '路线图规划'] },
        { _key: key(), title: 'UI/UX设计', description: '用户真正能理解的界面。基于研究的设计，减少流失并提高转化率。', icon: 'Users', features: ['用户研究', '线框图与流程', '原型设计', '可用性测试'] },
      ],
    },
  ],
};

const portfolioZH = {
  ...portfolioEN,
  language: 'zh',
  modules: [
    {
      ...portfolioEN.modules[0],
      _key: key(),
      heading: '我们的作品集',
      description: '在招聘、咨询、数字营销和电商领域的成功项目。从品牌创建到SEO主导地位。',
      visitSiteLabel: '访问网站',
    },
  ],
};

// ---------------------------------------------------------------------------
// Seed all pages
// ---------------------------------------------------------------------------

const pages = [
  homeEN, homeID, homeZH,
  aboutEN, aboutID, aboutZH,
  servicesEN, servicesID, servicesZH,
  portfolioEN, portfolioID, portfolioZH,
];

async function seed() {
  console.log(`Seeding ${pages.length} page documents to Sanity...`);

  for (const page of pages) {
    try {
      // Delete existing doc with same slug + language to avoid duplicates
      const existing = await client.fetch(
        `*[_type == "page" && slug.current == $slug && language == $lang][0]._id`,
        { slug: (page.slug as { current: string }).current, lang: page.language }
      );
      if (existing) {
        await client.delete(existing);
        console.log(`  Deleted existing: ${page.language}/${(page.slug as { current: string }).current}`);
      }

      await client.create(page);
      console.log(`  Created: ${page.language}/${(page.slug as { current: string }).current}`);
    } catch (err) {
      console.error(`  Failed: ${page.language}/${(page.slug as { current: string }).current}`, err);
    }
  }

  console.log('Done!');
}

seed();
