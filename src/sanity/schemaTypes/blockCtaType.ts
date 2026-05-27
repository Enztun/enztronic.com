import { BellIcon } from '@sanity/icons';
import { defineArrayMember, defineField, defineType } from 'sanity';

export const blockCtaType = defineType({
  name: 'ctaBlock',
  title: 'CTA Block',
  type: 'object',
  icon: BellIcon,
  fields: [
    defineField({
      name: 'headline',
      type: 'string',
      title: 'Headline',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'subheading',
      type: 'text',
      title: 'Subheading',
      rows: 2,
    }),
    defineField({
      name: 'buttons',
      title: 'Buttons',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({
              name: 'text',
              type: 'string',
              title: 'Button Text',
              validation: (r) => r.required(),
            }),
            defineField({
              name: 'href',
              type: 'string',
              title: 'URL or href (e.g. /contact, tel:+62..., https://wa.me/...)',
            }),
            defineField({
              name: 'style',
              type: 'string',
              title: 'Style',
              initialValue: 'primary',
              options: {
                list: [
                  { title: 'Primary (blue)', value: 'primary' },
                  { title: 'WhatsApp (green)', value: 'whatsapp' },
                  { title: 'Phone (white outline)', value: 'phone' },
                  { title: 'Outline', value: 'outline' },
                ],
              },
            }),
          ],
          preview: {
            select: { title: 'text', subtitle: 'style' },
          },
        }),
      ],
      validation: (r) => r.min(1).max(3),
    }),
    defineField({
      name: 'theme',
      title: 'Background Theme',
      type: 'string',
      initialValue: 'dark',
      options: {
        list: [
          { title: 'Dark (black)', value: 'dark' },
          { title: 'Primary (blue)', value: 'primary' },
          { title: 'Light (gray)', value: 'light' },
        ],
        layout: 'radio',
      },
    }),
  ],
  preview: {
    select: { title: 'headline' },
    prepare({ title }) {
      return { title: `CTA: ${title ?? 'untitled'}` };
    },
  },
});
