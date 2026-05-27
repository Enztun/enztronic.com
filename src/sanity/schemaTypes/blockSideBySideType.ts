import { BlockElementIcon } from '@sanity/icons';
import { defineField, defineType } from 'sanity';

export const blockSideBySideType = defineType({
  name: 'sideBySide',
  title: 'Side by Side',
  type: 'object',
  icon: BlockElementIcon,
  fields: [
    defineField({
      name: 'image',
      type: 'image',
      title: 'Image',
      options: { hotspot: true },
      fields: [{ name: 'alt', type: 'string', title: 'Alt text' }],
    }),
    defineField({
      name: 'imagePosition',
      title: 'Image Position',
      type: 'string',
      initialValue: 'left',
      options: {
        list: [
          { title: 'Image Left', value: 'left' },
          { title: 'Image Right', value: 'right' },
        ],
        layout: 'radio',
      },
    }),
    defineField({
      name: 'heading',
      type: 'string',
      title: 'Heading',
    }),
    defineField({
      name: 'body',
      type: 'text',
      title: 'Body text',
      rows: 4,
    }),
    defineField({
      name: 'emphasis',
      type: 'string',
      title: 'Bold callout line',
      description: 'Single bold sentence shown below the body text',
    }),
    defineField({
      name: 'ctaText',
      type: 'string',
      title: 'CTA Button Text',
    }),
    defineField({
      name: 'ctaHref',
      type: 'string',
      title: 'CTA URL or href',
    }),
  ],
  preview: {
    select: { title: 'heading', media: 'image' },
    prepare({ title, media }) {
      return { title: `Side by Side: ${title ?? 'untitled'}`, media };
    },
  },
});
