import { defineQuery } from 'next-sanity';

export const postsQuery = defineQuery(`
  *[_type == "post" && defined(slug.current) && publishedAt <= now()]
  | order(publishedAt desc) {
    _id,
    title,
    "slug": slug.current,
    excerpt,
    publishedAt,
    language,
    mainImage,
    "categories": categories[]->{ title, "slug": slug.current },
    "author": author->{ name }
  }
`);

export const postsByLocaleQuery = defineQuery(`
  *[_type == "post" && defined(slug.current) && publishedAt <= now() && language == $locale]
  | order(publishedAt desc) {
    _id,
    title,
    "slug": slug.current,
    excerpt,
    publishedAt,
    language,
    mainImage,
    "categories": categories[]->{ title, "slug": slug.current },
    "author": author->{ name }
  }
`);

export const postBySlugQuery = defineQuery(`
  *[_type == "post" && slug.current == $slug && language == $locale][0] {
    _id,
    _updatedAt,
    title,
    "slug": slug.current,
    excerpt,
    publishedAt,
    language,
    mainImage,
    body,
    "categories": categories[]->{ title, "slug": slug.current },
    "author": author->{ name, image, bio }
  }
`);

export const postSlugsQuery = defineQuery(`
  *[_type == "post" && defined(slug.current)] { "slug": slug.current, language }
`);

export const postSitemapQuery = defineQuery(`
  *[_type == "post" && defined(slug.current) && publishedAt <= now()] {
    "slug": slug.current,
    "locale": coalesce(language, "en"),
    _updatedAt,
  }
`);

export const pageBySlugQuery = defineQuery(`
  *[_type == "page" && slug.current == $slug && language == $language][0] {
    _id,
    title,
    language,
    modules,
    "seoTitle": seo.title,
    "seoDescription": seo.description,
  }
`);

export const pageSeoBySlugQuery = defineQuery(`
  *[_type == "page" && slug.current == $slug && language == $language][0] {
    "seoTitle": seo.title,
    "seoDescription": seo.description,
  }
`);
