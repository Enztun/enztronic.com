import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { visionTool } from '@sanity/vision';
import { EnvelopeIcon, DocumentTextIcon, UsersIcon, TagIcon } from '@sanity/icons';
import { schemaTypes } from './src/sanity/schemaTypes';

export default defineConfig({
  name: 'enztronic',
  title: 'Enztronic',
  basePath: '/studio',
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production',
  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title('Enztronic')
          .items([
            S.listItem()
              .title('Inquiries')
              .icon(EnvelopeIcon)
              .child(
                S.documentList()
                  .title('Inquiries')
                  .filter('_type == "inquiry"')
                  .defaultOrdering([{ field: 'submittedAt', direction: 'desc' }])
              ),
            S.divider(),
            S.listItem()
              .title('Posts')
              .icon(DocumentTextIcon)
              .child(S.documentTypeList('post').title('Posts')),
            S.listItem()
              .title('Authors')
              .icon(UsersIcon)
              .child(S.documentTypeList('author').title('Authors')),
            S.listItem()
              .title('Categories')
              .icon(TagIcon)
              .child(S.documentTypeList('category').title('Categories')),
          ]),
    }),
    visionTool(),
  ],
  schema: { types: schemaTypes },
});
