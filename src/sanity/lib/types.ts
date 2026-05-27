export type PostSummary = {
  _id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  publishedAt: string | null;
  language: string | null;
  mainImage: { asset?: unknown; alt?: string } | null;
  categories: Array<{ title: string; slug: string }> | null;
  author: { name: string } | null;
};

export type PostDetail = PostSummary & {
  body: unknown;
  author: {
    name: string;
    image: unknown | null;
    bio: unknown | null;
  } | null;
};
