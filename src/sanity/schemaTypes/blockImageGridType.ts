import { ImageIcon } from '@sanity/icons';
import { defineArrayMember, defineField, defineType } from 'sanity';

export const blockImageGridType = defineType({
  name: 'imageGrid',
  title: 'Image Grid',
  type: 'object',
  icon: ImageIcon,
  fields: [
    defineField({
      name: 'items',
      title: 'Images',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({
              name: 'image',
              type: 'image',
              title: 'Image',
              options: { hotspot: true },
              fields: [{ name: 'alt', type: 'string', title: 'Alt text' }],
              validation: (r) => r.required(),
            }),
            defineField({ name: 'title', type: 'string', title: 'Title' }),
            defineField({ name: 'caption', type: 'string', title: 'Caption' }),
          ],
          preview: {
            select: { title: 'title', media: 'image' },
            prepare({ title, media }) {
              return { title: title ?? 'Image', media };
            },
          },
        }),
      ],
      validation: (r) => r.min(2).max(6),
    }),
    defineField({
      name: 'columns',
      title: 'Columns',
      type: 'number',
      initialValue: 4,
      options: {
        list: [
          { title: '2 columns', value: 2 },
          { title: '3 columns', value: 3 },
          { title: '4 columns', value: 4 },
        ],
      },
    }),
  ],
  preview: {
    select: { count: 'items' },
    prepare({ count }) {
      return { title: `Image Grid (${Array.isArray(count) ? count.length : 0} images)` };
    },
  },
});
