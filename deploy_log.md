22:23:00.648 Running build in Washington, D.C., USA (East) – iad1
22:23:00.652 Build machine configuration: 2 cores, 8 GB
22:23:00.855 Cloning github.com/Enztun/enztronic.com (Branch: main, Commit: 91a1e74)
22:23:00.857 Previous build caches not available.
22:23:01.619 Cloning completed: 763.000ms
22:23:02.069 Running "vercel build"
22:23:02.103 Vercel CLI 53.3.2
22:23:02.441 Installing dependencies...
22:23:16.068 
22:23:16.068 added 367 packages in 13s
22:23:16.069 
22:23:16.069 146 packages are looking for funding
22:23:16.069   run `npm fund` for details
22:23:16.149 Detected Next.js version: 16.2.6
22:23:16.155 Running "npm run build"
22:23:16.267 
22:23:16.268 > enztronic@0.1.0 build
22:23:16.268 > next build
22:23:16.268 
22:23:16.796   Applying modifyConfig from Vercel
22:23:16.801 Attention: Next.js now collects completely anonymous telemetry regarding usage.
22:23:16.802 This information is used to shape Next.js' roadmap and prioritize features.
22:23:16.802 You can learn more, including how to opt-out if you'd not like to participate in this anonymous program, by visiting the following URL:
22:23:16.803 https://nextjs.org/telemetry
22:23:16.803 
22:23:16.821 ▲ Next.js 16.2.6 (Turbopack)
22:23:16.822 
22:23:16.855   Creating an optimized production build ...
22:23:23.380 
22:23:23.380 > Build error occurred
22:23:23.385 Error: Turbopack build failed with 14 errors:
22:23:23.386 ./src/app/globals.css
22:23:23.386 Error evaluating Node.js code
22:23:23.386 Error: Cannot find module 'autoprefixer'
22:23:23.386 Require stack:
22:23:23.386 - /vercel/path0/.next/build/chunks/[root-of-the-server]__0iv9ksq._.js
22:23:23.386 - /vercel/path0/.next/build/chunks/[turbopack]_runtime.js
22:23:23.387 - /vercel/path0/.next/build/postcss.js
22:23:23.387     [at Module._resolveFilename (node:internal/modules/cjs/loader:1476:15)]
22:23:23.387     [at wrapResolveFilename (node:internal/modules/cjs/loader:1049:27)]
22:23:23.387     [at defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1073:10)]
22:23:23.387     [at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1094:12)]
22:23:23.387     [at Module._load (node:internal/modules/cjs/loader:1262:25)]
22:23:23.387     [at wrapModuleLoad (node:internal/modules/cjs/loader:255:19)]
22:23:23.387     [at Module.require (node:internal/modules/cjs/loader:1576:12)]
22:23:23.387     [at require (node:internal/modules/helpers:153:16)]
22:23:23.387     at require (turbopack:///[turbopack-node]/transforms/postcss.ts:49:25) [/vercel/path0/.next/build/chunks/[root-of-the-server]__0iv9ksq._.js:160:33]
22:23:23.387     [at <anonymous>]
22:23:23.388 
22:23:23.388 Import trace:
22:23:23.388   Client Component Browser:
22:23:23.388     ./src/app/globals.css [Client Component Browser]
22:23:23.388     ./src/app/layout.tsx [Server Component]
22:23:23.388 
22:23:23.388 
22:23:23.388 ./src/sanity/schemaTypes/authorType.ts:1:1
22:23:23.388 Module not found: Can't resolve '@sanity/icons'
22:23:23.388 > 1 | import {UserIcon} from '@sanity/icons'
22:23:23.388     | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
22:23:23.388   2 | import {defineArrayMember, defineField, defineType} from 'sanity'
22:23:23.388   3 |
22:23:23.388   4 | export const authorType = defineType({
22:23:23.388 
22:23:23.388 
22:23:23.388 
22:23:23.388 Import traces:
22:23:23.388   Client Component Browser:
22:23:23.388     ./src/sanity/schemaTypes/authorType.ts [Client Component Browser]
22:23:23.389     ./src/sanity/schemaTypes/index.ts [Client Component Browser]
22:23:23.389     ./sanity.config.ts [Client Component Browser]
22:23:23.389     ./sanity.config.ts [Server Component]
22:23:23.389     ./src/app/studio/[[...tool]]/page.tsx [Server Component]
22:23:23.389 
22:23:23.389   Client Component SSR:
22:23:23.389     ./src/sanity/schemaTypes/authorType.ts [Client Component SSR]
22:23:23.389     ./src/sanity/schemaTypes/index.ts [Client Component SSR]
22:23:23.389     ./sanity.config.ts [Client Component SSR]
22:23:23.389     ./sanity.config.ts [Server Component]
22:23:23.389     ./src/app/studio/[[...tool]]/page.tsx [Server Component]
22:23:23.389 
22:23:23.389 https://nextjs.org/docs/messages/module-not-found
22:23:23.389 
22:23:23.389 
22:23:23.389 ./src/sanity/schemaTypes/blockContentType.ts:2:1
22:23:23.389 Module not found: Can't resolve '@sanity/icons'
22:23:23.389   1 | import {defineType, defineArrayMember} from 'sanity'
22:23:23.389 > 2 | import {ImageIcon} from '@sanity/icons'
22:23:23.390     | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
22:23:23.390   3 |
22:23:23.390   4 | /**
22:23:23.390   5 |  * This is the schema type for block content used in the post document type
22:23:23.390 
22:23:23.390 
22:23:23.390 
22:23:23.390 Import traces:
22:23:23.390   Client Component Browser:
22:23:23.390     ./src/sanity/schemaTypes/blockContentType.ts [Client Component Browser]
22:23:23.390     ./src/sanity/schemaTypes/index.ts [Client Component Browser]
22:23:23.390     ./sanity.config.ts [Client Component Browser]
22:23:23.390     ./sanity.config.ts [Server Component]
22:23:23.390     ./src/app/studio/[[...tool]]/page.tsx [Server Component]
22:23:23.395 
22:23:23.395   Client Component SSR:
22:23:23.396     ./src/sanity/schemaTypes/blockContentType.ts [Client Component SSR]
22:23:23.396     ./src/sanity/schemaTypes/index.ts [Client Component SSR]
22:23:23.396     ./sanity.config.ts [Client Component SSR]
22:23:23.396     ./sanity.config.ts [Server Component]
22:23:23.396     ./src/app/studio/[[...tool]]/page.tsx [Server Component]
22:23:23.396 
22:23:23.396 https://nextjs.org/docs/messages/module-not-found
22:23:23.396 
22:23:23.396 
22:23:23.396 ./src/sanity/schemaTypes/categoryType.ts:1:1
22:23:23.396 Module not found: Can't resolve '@sanity/icons'
22:23:23.396 > 1 | import {TagIcon} from '@sanity/icons'
22:23:23.396     | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
22:23:23.396   2 | import {defineField, defineType} from 'sanity'
22:23:23.396   3 |
22:23:23.396   4 | export const categoryType = defineType({
22:23:23.397 
22:23:23.397 
22:23:23.397 
22:23:23.397 Import traces:
22:23:23.397   Client Component Browser:
22:23:23.397     ./src/sanity/schemaTypes/categoryType.ts [Client Component Browser]
22:23:23.397     ./src/sanity/schemaTypes/index.ts [Client Component Browser]
22:23:23.397     ./sanity.config.ts [Client Component Browser]
22:23:23.397     ./sanity.config.ts [Server Component]
22:23:23.397     ./src/app/studio/[[...tool]]/page.tsx [Server Component]
22:23:23.397 
22:23:23.397   Client Component SSR:
22:23:23.397     ./src/sanity/schemaTypes/categoryType.ts [Client Component SSR]
22:23:23.397     ./src/sanity/schemaTypes/index.ts [Client Component SSR]
22:23:23.397     ./sanity.config.ts [Client Component SSR]
22:23:23.397     ./sanity.config.ts [Server Component]
22:23:23.397     ./src/app/studio/[[...tool]]/page.tsx [Server Component]
22:23:23.397 
22:23:23.397 https://nextjs.org/docs/messages/module-not-found
22:23:23.398 
22:23:23.398 
22:23:23.398 ./src/sanity/schemaTypes/postType.ts:1:1
22:23:23.398 Module not found: Can't resolve '@sanity/icons'
22:23:23.398 > 1 | import {DocumentTextIcon} from '@sanity/icons'
22:23:23.398     | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
22:23:23.399   2 | import {defineArrayMember, defineField, defineType} from 'sanity'
22:23:23.399   3 |
22:23:23.399   4 | export const postType = defineType({
22:23:23.399 
22:23:23.399 
22:23:23.399 
22:23:23.399 Import traces:
22:23:23.399   Client Component Browser:
22:23:23.399     ./src/sanity/schemaTypes/postType.ts [Client Component Browser]
22:23:23.399     ./src/sanity/schemaTypes/index.ts [Client Component Browser]
22:23:23.399     ./sanity.config.ts [Client Component Browser]
22:23:23.399     ./sanity.config.ts [Server Component]
22:23:23.400     ./src/app/studio/[[...tool]]/page.tsx [Server Component]
22:23:23.400 
22:23:23.400   Client Component SSR:
22:23:23.400     ./src/sanity/schemaTypes/postType.ts [Client Component SSR]
22:23:23.400     ./src/sanity/schemaTypes/index.ts [Client Component SSR]
22:23:23.400     ./sanity.config.ts [Client Component SSR]
22:23:23.400     ./sanity.config.ts [Server Component]
22:23:23.400     ./src/app/studio/[[...tool]]/page.tsx [Server Component]
22:23:23.400 
22:23:23.400 https://nextjs.org/docs/messages/module-not-found
22:23:23.400 
22:23:23.400 
22:23:23.400 ./sanity.config.ts:3:1
22:23:23.400 Module not found: Can't resolve '@sanity/vision'
22:23:23.400   1 | 'use client'
22:23:23.400   2 |
22:23:23.400 > 3 | import { visionTool } from '@sanity/vision'
22:23:23.400     | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
22:23:23.400   4 | import { defineConfig } from 'sanity'
22:23:23.400   5 | import { structureTool } from 'sanity/structure'
22:23:23.400   6 |
22:23:23.400 
22:23:23.400 
22:23:23.400 
22:23:23.401 Import trace:
22:23:23.401   Server Component:
22:23:23.401     ./sanity.config.ts
22:23:23.401     ./src/app/studio/[[...tool]]/page.tsx
22:23:23.401 
22:23:23.401 https://nextjs.org/docs/messages/module-not-found
22:23:23.401 
22:23:23.401 
22:23:23.401 ./src/app/studio/[[...tool]]/page.tsx:10:1
22:23:23.401 Module not found: Can't resolve 'next-sanity/studio'
22:23:23.401    8 |  */
22:23:23.401    9 |
22:23:23.401 > 10 | import { NextStudio } from 'next-sanity/studio'
22:23:23.401      | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
22:23:23.401   11 | import config from '../../../../sanity.config'
22:23:23.401   12 |
22:23:23.401   13 | export const dynamic = 'force-static'
22:23:23.401 
22:23:23.401 
22:23:23.401 
22:23:23.401 https://nextjs.org/docs/messages/module-not-found
22:23:23.401 
22:23:23.401 
22:23:23.401 ./src/app/studio/[[...tool]]/page.tsx:15:1
22:23:23.401 Module not found: Can't resolve 'next-sanity/studio'
22:23:23.402   13 | export const dynamic = 'force-static'
22:23:23.402   14 |
22:23:23.402 > 15 | export { metadata, viewport } from 'next-sanity/studio'
22:23:23.402      | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
22:23:23.402   16 |
22:23:23.402   17 | export default function StudioPage() {
22:23:23.402   18 |   return <NextStudio config={config} />
22:23:23.402 
22:23:23.402 
22:23:23.402 
22:23:23.402 https://nextjs.org/docs/messages/module-not-found
22:23:23.402 
22:23:23.402 
22:23:23.402 ./sanity.config.ts:4:1
22:23:23.402 Module not found: Can't resolve 'sanity'
22:23:23.402   2 |
22:23:23.402   3 | import { visionTool } from '@sanity/vision'
22:23:23.402 > 4 | import { defineConfig } from 'sanity'
22:23:23.402     | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
22:23:23.402   5 | import { structureTool } from 'sanity/structure'
22:23:23.402   6 |
22:23:23.402   7 | import { schema } from './src/sanity/schemaTypes'
22:23:23.402 
22:23:23.402 
22:23:23.402 
22:23:23.402 Import trace:
22:23:23.403   Server Component:
22:23:23.403     ./sanity.config.ts
22:23:23.403     ./src/app/studio/[[...tool]]/page.tsx
22:23:23.403 
22:23:23.403 https://nextjs.org/docs/messages/module-not-found
22:23:23.403 
22:23:23.403 
22:23:23.403 ./src/sanity/schemaTypes/authorType.ts:2:1
22:23:23.403 Module not found: Can't resolve 'sanity'
22:23:23.403   1 | import {UserIcon} from '@sanity/icons'
22:23:23.403 > 2 | import {defineArrayMember, defineField, defineType} from 'sanity'
22:23:23.403     | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
22:23:23.403   3 |
22:23:23.403   4 | export const authorType = defineType({
22:23:23.403   5 |   name: 'author',
22:23:23.403 
22:23:23.403 
22:23:23.403 
22:23:23.403 Import traces:
22:23:23.403   Client Component Browser:
22:23:23.403     ./src/sanity/schemaTypes/authorType.ts [Client Component Browser]
22:23:23.403     ./src/sanity/schemaTypes/index.ts [Client Component Browser]
22:23:23.403     ./sanity.config.ts [Client Component Browser]
22:23:23.403     ./sanity.config.ts [Server Component]
22:23:23.403     ./src/app/studio/[[...tool]]/page.tsx [Server Component]
22:23:23.403 
22:23:23.404   Client Component SSR:
22:23:23.404     ./src/sanity/schemaTypes/authorType.ts [Client Component SSR]
22:23:23.404     ./src/sanity/schemaTypes/index.ts [Client Component SSR]
22:23:23.404     ./sanity.config.ts [Client Component SSR]
22:23:23.404     ./sanity.config.ts [Server Component]
22:23:23.404     ./src/app/studio/[[...tool]]/page.tsx [Server Component]
22:23:23.404 
22:23:23.404 https://nextjs.org/docs/messages/module-not-found
22:23:23.404 
22:23:23.404 
22:23:23.404 ./src/sanity/schemaTypes/blockContentType.ts:1:1
22:23:23.404 Module not found: Can't resolve 'sanity'
22:23:23.404 > 1 | import {defineType, defineArrayMember} from 'sanity'
22:23:23.404     | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
22:23:23.404   2 | import {ImageIcon} from '@sanity/icons'
22:23:23.404   3 |
22:23:23.404   4 | /**
22:23:23.404 
22:23:23.404 
22:23:23.404 
22:23:23.404 Import traces:
22:23:23.404   Client Component Browser:
22:23:23.404     ./src/sanity/schemaTypes/blockContentType.ts [Client Component Browser]
22:23:23.404     ./src/sanity/schemaTypes/index.ts [Client Component Browser]
22:23:23.404     ./sanity.config.ts [Client Component Browser]
22:23:23.404     ./sanity.config.ts [Server Component]
22:23:23.405     ./src/app/studio/[[...tool]]/page.tsx [Server Component]
22:23:23.405 
22:23:23.405   Client Component SSR:
22:23:23.405     ./src/sanity/schemaTypes/blockContentType.ts [Client Component SSR]
22:23:23.405     ./src/sanity/schemaTypes/index.ts [Client Component SSR]
22:23:23.405     ./sanity.config.ts [Client Component SSR]
22:23:23.405     ./sanity.config.ts [Server Component]
22:23:23.405     ./src/app/studio/[[...tool]]/page.tsx [Server Component]
22:23:23.405 
22:23:23.405 https://nextjs.org/docs/messages/module-not-found
22:23:23.405 
22:23:23.405 
22:23:23.405 ./src/sanity/schemaTypes/categoryType.ts:2:1
22:23:23.405 Module not found: Can't resolve 'sanity'
22:23:23.405   1 | import {TagIcon} from '@sanity/icons'
22:23:23.405 > 2 | import {defineField, defineType} from 'sanity'
22:23:23.405     | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
22:23:23.405   3 |
22:23:23.405   4 | export const categoryType = defineType({
22:23:23.405   5 |   name: 'category',
22:23:23.405 
22:23:23.405 
22:23:23.405 
22:23:23.405 Import traces:
22:23:23.405   Client Component Browser:
22:23:23.405     ./src/sanity/schemaTypes/categoryType.ts [Client Component Browser]
22:23:23.406     ./src/sanity/schemaTypes/index.ts [Client Component Browser]
22:23:23.406     ./sanity.config.ts [Client Component Browser]
22:23:23.406     ./sanity.config.ts [Server Component]
22:23:23.406     ./src/app/studio/[[...tool]]/page.tsx [Server Component]
22:23:23.406 
22:23:23.406   Client Component SSR:
22:23:23.406     ./src/sanity/schemaTypes/categoryType.ts [Client Component SSR]
22:23:23.406     ./src/sanity/schemaTypes/index.ts [Client Component SSR]
22:23:23.406     ./sanity.config.ts [Client Component SSR]
22:23:23.406     ./sanity.config.ts [Server Component]
22:23:23.406     ./src/app/studio/[[...tool]]/page.tsx [Server Component]
22:23:23.406 
22:23:23.406 https://nextjs.org/docs/messages/module-not-found
22:23:23.406 
22:23:23.406 
22:23:23.406 ./src/sanity/schemaTypes/postType.ts:2:1
22:23:23.406 Module not found: Can't resolve 'sanity'
22:23:23.406   1 | import {DocumentTextIcon} from '@sanity/icons'
22:23:23.406 > 2 | import {defineArrayMember, defineField, defineType} from 'sanity'
22:23:23.406     | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
22:23:23.406   3 |
22:23:23.406   4 | export const postType = defineType({
22:23:23.406   5 |   name: 'post',
22:23:23.406 
22:23:23.406 
22:23:23.406 
22:23:23.407 Import traces:
22:23:23.407   Client Component Browser:
22:23:23.407     ./src/sanity/schemaTypes/postType.ts [Client Component Browser]
22:23:23.407     ./src/sanity/schemaTypes/index.ts [Client Component Browser]
22:23:23.407     ./sanity.config.ts [Client Component Browser]
22:23:23.407     ./sanity.config.ts [Server Component]
22:23:23.407     ./src/app/studio/[[...tool]]/page.tsx [Server Component]
22:23:23.407 
22:23:23.407   Client Component SSR:
22:23:23.407     ./src/sanity/schemaTypes/postType.ts [Client Component SSR]
22:23:23.407     ./src/sanity/schemaTypes/index.ts [Client Component SSR]
22:23:23.407     ./sanity.config.ts [Client Component SSR]
22:23:23.407     ./sanity.config.ts [Server Component]
22:23:23.407     ./src/app/studio/[[...tool]]/page.tsx [Server Component]
22:23:23.407 
22:23:23.407 https://nextjs.org/docs/messages/module-not-found
22:23:23.407 
22:23:23.407 
22:23:23.407 ./sanity.config.ts:5:1
22:23:23.407 Module not found: Can't resolve 'sanity/structure'
22:23:23.407   3 | import { visionTool } from '@sanity/vision'
22:23:23.407   4 | import { defineConfig } from 'sanity'
22:23:23.407 > 5 | import { structureTool } from 'sanity/structure'
22:23:23.408     | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
22:23:23.408   6 |
22:23:23.408   7 | import { schema } from './src/sanity/schemaTypes'
22:23:23.408   8 | import { structure } from './src/sanity/structure'
22:23:23.408 
22:23:23.408 
22:23:23.408 
22:23:23.408 Import trace:
22:23:23.408   Server Component:
22:23:23.408     ./sanity.config.ts
22:23:23.408     ./src/app/studio/[[...tool]]/page.tsx
22:23:23.408 
22:23:23.408 https://nextjs.org/docs/messages/module-not-found
22:23:23.408 
22:23:23.408 
22:23:23.408     at require (turbopack:///[turbopack-node]/transforms/postcss.ts:49:25) [/vercel/path0/.next/build/chunks/[root-of-the-server]__0iv9ksq._.js:160:33])
22:23:23.408     at <unknown> (./src/sanity/schemaTypes/authorType.ts:1:1)
22:23:23.408     at <unknown> (https://nextjs.org/docs/messages/module-not-found)
22:23:23.408     at <unknown> (./src/sanity/schemaTypes/blockContentType.ts:2:1)
22:23:23.408     at <unknown> (https://nextjs.org/docs/messages/module-not-found)
22:23:23.408     at <unknown> (./src/sanity/schemaTypes/categoryType.ts:1:1)
22:23:23.408     at <unknown> (https://nextjs.org/docs/messages/module-not-found)
22:23:23.408     at <unknown> (./src/sanity/schemaTypes/postType.ts:1:1)
22:23:23.408     at <unknown> (https://nextjs.org/docs/messages/module-not-found)
22:23:23.409     at <unknown> (./sanity.config.ts:3:1)
22:23:23.409     at <unknown> (https://nextjs.org/docs/messages/module-not-found)
22:23:23.409     at <unknown> (./src/app/studio/[[...tool]]/page.tsx:10:1)
22:23:23.409     at <unknown> (https://nextjs.org/docs/messages/module-not-found)
22:23:23.409     at <unknown> (./src/app/studio/[[...tool]]/page.tsx:15:1)
22:23:23.409     at <unknown> (https://nextjs.org/docs/messages/module-not-found)
22:23:23.409     at <unknown> (./sanity.config.ts:4:1)
22:23:23.409     at <unknown> (https://nextjs.org/docs/messages/module-not-found)
22:23:23.409     at <unknown> (./src/sanity/schemaTypes/authorType.ts:2:1)
22:23:23.409     at <unknown> (https://nextjs.org/docs/messages/module-not-found)
22:23:23.409     at <unknown> (./src/sanity/schemaTypes/blockContentType.ts:1:1)
22:23:23.409     at <unknown> (https://nextjs.org/docs/messages/module-not-found)
22:23:23.409     at <unknown> (./src/sanity/schemaTypes/categoryType.ts:2:1)
22:23:23.409     at <unknown> (https://nextjs.org/docs/messages/module-not-found)
22:23:23.409     at <unknown> (./src/sanity/schemaTypes/postType.ts:2:1)
22:23:23.409     at <unknown> (https://nextjs.org/docs/messages/module-not-found)
22:23:23.409     at <unknown> (./sanity.config.ts:5:1)
22:23:23.409     at <unknown> (https://nextjs.org/docs/messages/module-not-found)
22:23:23.458 Error: Command "npm run build" exited with 1