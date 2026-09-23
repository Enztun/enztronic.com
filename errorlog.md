# Error and release notices

## 2026-09-24 - UX release bf02db2

Production deployment dpl_7Vu4FeFS2W6Pfp1rhPXWY89VMEFU is READY. Local build/TypeScript, 28 UX groups, and both-theme contrast checks passed. The live smoke checks observed no browser exceptions; Vercel's error query returned no entries during the release window.

### Outstanding operational issue

GitHub Actions contrast run 35905086667 failed before any job steps executed. Check annotation 107330641423 reports: "The job was not started because your account is locked due to a billing issue."

Run: https://github.com/Enztun/enztronic.com/actions/runs/35905086667

The same billing annotation was present on the preceding main commit. GitHub billing/account status needs resolution before hosted CI can run; Vercel's independent production build and the local checks passed.

### Non-blocking notices

- Existing ESLint warning: unused title in scripts/capture-screenshots.mjs:59.
- Vercel clone warning: failed to fetch one or more git submodules. The public frontend built and deployed successfully.
- npm reported five packages with install scripts not yet covered by allowScripts (@parcel/watcher, esbuild, @swc/core, sharp, unrs-resolver). No build failure resulted; no blanket script approval was added.

### Verification limits

Production enquiries and paid AI calls were not sent. Failure/retry/success form and chat flows were tested locally with intercepted requests. Physical-device behavior and long-term runtime monitoring are outside this release verification. Reporting integration remains deferred by user choice.

## Historical output (preserved)

17:50:38.531 Running build in Washington, D.C., USA (East) – iad1
17:50:38.532 Build machine configuration: 2 cores, 8 GB
17:50:38.664 Cloning github.com/Enztun/enztronic.com (Branch: main, Commit: 18fc4a7)
17:50:40.948 Warning: Failed to fetch one or more git submodules
17:50:40.950 Cloning completed: 2.285s
17:50:41.455 Restored build cache from previous deployment (FXiqAspwheAFA5dokEbB3aXQbrXM)
17:50:41.833 Running "vercel build"
17:50:41.849 Vercel CLI 54.4.1
17:50:42.167 Installing dependencies...
17:50:44.268 
17:50:44.268 up to date in 2s
17:50:44.269 
17:50:44.269 316 packages are looking for funding
17:50:44.270   run `npm fund` for details
17:50:44.300 Detected Next.js version: 16.2.6
17:50:44.300 Running "npm run build"
17:50:44.408 
17:50:44.409 > enztronic@0.1.0 build
17:50:44.409 > next build
17:50:44.410 
17:50:45.651   Applying modifyConfig from Vercel
17:50:45.668 ▲ Next.js 16.2.6 (Turbopack)
17:50:45.669 
17:50:45.710   Creating an optimized production build ...
17:51:40.047 ✓ Compiled successfully in 54s
17:51:40.054   Running TypeScript ...
17:51:47.566   Finished TypeScript in 7.5s ...
17:51:47.610   Collecting page data using 1 worker ...
17:51:48.143   Generating static pages using 1 worker (0/26) ...
17:51:48.536   Generating static pages using 1 worker (6/26) 
17:51:48.699   Generating static pages using 1 worker (12/26) 
17:51:48.748   Generating static pages using 1 worker (19/26) 
17:51:48.890 ✓ Generating static pages using 1 worker (26/26) in 748ms
17:51:48.897   Finalizing page optimization ...
17:51:48.924   Running onBuildComplete from Vercel
17:51:49.030 
17:51:49.033 Route (app)
17:51:49.033 ┌ ○ /_not-found
17:51:49.033 ├ ƒ /[locale]
17:51:49.033 ├ ƒ /[locale]/about
17:51:49.034 ├ ƒ /[locale]/blog
17:51:49.034 ├ ● /[locale]/blog/[slug]
17:51:49.034 ├ ƒ /[locale]/contact
17:51:49.034 ├ ƒ /[locale]/portfolio
17:51:49.034 ├ ƒ /[locale]/services
17:51:49.034 ├ ƒ /api/contact
17:51:49.034 ├ ƒ /api/draft-mode/disable
17:51:49.035 ├ ƒ /api/draft-mode/enable
17:51:49.035 ├ ○ /robots.txt
17:51:49.035 ├ ○ /sitemap.xml
17:51:49.035 └ ƒ /studio/[[...tool]]
17:51:49.035 
17:51:49.035 
17:51:49.035 ƒ Proxy (Middleware)
17:51:49.036 
17:51:49.036 ○  (Static)   prerendered as static content
17:51:49.036 ●  (SSG)      prerendered as static HTML (uses generateStaticParams)
17:51:49.036 ƒ  (Dynamic)  server-rendered on demand
17:51:49.036 
17:51:49.603 Build Completed in /vercel/output [1m]
17:51:49.961 Deploying outputs...