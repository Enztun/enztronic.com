'use client'

import { visionTool } from '@sanity/vision'
import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'

import { schema } from './src/sanity/schemaTypes'
import { structure } from './src/sanity/structure'

export default defineConfig({
  basePath: '/studio',
  projectId: '7k9f0gp3', // ← from manage.sanity.io
  dataset: 'production',        // ← or whatever dataset name you use
  schema,
  plugins: [
    structureTool({ structure }),
    visionTool({ defaultApiVersion: '2024-08-01' }), // can match your apiVersion
  ],
})
