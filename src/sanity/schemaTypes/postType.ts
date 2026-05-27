import { DocumentTextIcon } from '@sanity/icons';
import { defineField, defineType } from 'sanity';

export const postType = defineType({
  name: 'post',
  title: 'Post',
  type: 'document',
  icon: DocumentTextIcon,
  groups: [
    { name: 'content', title: 'Content', default: true },
    { name: 'settings', title: 'Settings' },
    { name: 'seo', title: 'SEO' },
  ],
  fields: [
    defineField({
      name: 'title',
      type: 'string',
      group: 'content',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'slug',
      type: 'slug',
      group: 'content',
      options: { source: 'title', maxLength: 96 },
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'body',
      title: 'Body',
      type: 'blockContent',
      group: 'content',
    }),
    defineField({
      name: 'language',
      title: 'Language',
      type: 'string',
      group: 'settings',
      initialValue: 'en',
      options: {
        list: [
          { title: 'English', value: 'en' },
          { title: 'Indonesian', value: 'id' },
          { title: 'Chinese (Simplified)', value: 'zh' },
        ],
      },
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'author',
      type: 'reference',
      group: 'settings',
      to: { type: 'author' },
    }),
    defineField({
      name: 'categories',
      type: 'array',
      group: 'settings',
      of: [{ type: 'reference', to: { type: 'category' } }],
    }),
    defineField({
      name: 'publishedAt',
      type: 'datetime',
      group: 'settings',
      initialValue: () => new Date().toISOString(),
    }),
    defineField({
      name: 'excerpt',
      type: 'text',
      group: 'seo',
      rows: 3,
      description: 'Short summary shown in post listings and metadata.',
      validation: (r) => r.max(200),
    }),
    defineField({
      name: 'mainImage',
      type: 'image',
      group: 'seo',
      options: { hotspot: true },
      fields: [
        {
          name: 'alt',
          type: 'string',
          title: 'Alt text',
          validation: (r) => r.required(),
        },
      ],
    }),
  ],
  preview: {
    select: {
      title: 'title',
      author: 'author.name',
      media: 'mainImage',
      language: 'language',
    },
    prepare({ title, author, media, language }) {
      return {
        title,
        subtitle: `${language?.toUpperCase() ?? 'EN'} · ${author ?? 'No author'}`,
        media,
      };
    },
  },
});
