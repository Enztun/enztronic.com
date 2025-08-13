| Scenario                              | Command                      | Run in New Tab?       | Notes                                                                                                           |
| ------------------------------------- | ---------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Start Next.js locally**             | `npm run dev`                | ✅ Yes (dedicated tab) | Runs your website locally at `http://localhost:3000`. Keep it running while you test.                           |
| **Start Sanity Studio locally**       | `npx sanity dev`             | ✅ Yes (dedicated tab) | Opens Studio at `http://localhost:3333`. Lets you edit content locally before deploying.                        |
| **Deploy Sanity Studio to the cloud** | `npx sanity deploy`          | ✅ Yes                 | Only needed when you change schema/config files. Makes the updated Studio available at your Sanity project URL. |
| **Deploy Next.js site to production** | `vercel` or Vercel dashboard | ✅ Yes                 | Pushes your Next.js site to your live domain. Can be linked to Git for auto-deploys.                            |
| **Install dependencies**              | `npm install package-name`   | ✅ Yes                 | Add packages while dev servers are running — no restart needed unless the package affects the startup.          |



💡 Quick rules:

If you edit content in Sanity → just refresh the browser.

If you edit schema in Sanity → run npx sanity deploy.

If you edit Next.js code → it updates automatically while npm run dev is running.

          ┌─────────────┐
          │ Sanity CMS  │
          │ (Cloud)     │
          └─────┬───────┘
                │
                │ 1. Deploy schema/config → npx sanity deploy
                │
        ┌───────▼────────┐
        │ Sanity Studio  │  (Local: npx sanity dev)
        └───────┬────────┘
                │
                │ 2. Edit content → saved to Sanity Cloud instantly
                │
        ┌───────▼────────┐
        │ Next.js App    │  (Local: npm run dev)
        │ (Frontend)     │
        └───────┬────────┘
                │
                │ 3. Fetch content from Sanity via API
                │
        ┌───────▼─────────┐
        │ Browser Preview │
        │ localhost:3000  │
        └─────────────────┘


Key points:

Schema changes → need npx sanity deploy.

Content changes → no deploy needed; appears instantly in Next.js while npm run dev is running.

Frontend changes → save in VS Code; auto-reloads.