# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic [ref=e5]: "[plugin:vite:import-analysis]"
    - generic [ref=e6]: Failed to resolve import "../../ps/streams" from "src/routes/org.$orgId.repo.$repoId.index.tsx". Does the file exist?
  - generic [ref=e8] [cursor=pointer]: /Users/admin/git/powergit/packages/apps/explorer/src/routes/org.$orgId.repo.$repoId.index.tsx:4:31
  - generic [ref=e9]: "17 | var _s = $RefreshSig$(); 18 | import { createFileRoute, useParams, Link } from \"@tanstack/react-router\"; 19 | import { useRepoStreams } from \"../../ps/streams\"; | ^ 20 | import { useCollections } from \"../../tsdb/collections\"; 21 | import { useLiveQuery } from \"@tanstack/react-db\";"
  - generic [ref=e10]:
    - text: "at TransformPluginContext._formatError (file:"
    - generic [ref=e11] [cursor=pointer]: ///Users/admin/git/powergit/node_modules/.pnpm/vite@5.4.20_@types+node@20.19.19/node_modules/vite/dist/node/chunks/dep-D_zLpgQd.js:49258:41
    - text: ") at TransformPluginContext.error (file:"
    - generic [ref=e12] [cursor=pointer]: ///Users/admin/git/powergit/node_modules/.pnpm/vite@5.4.20_@types+node@20.19.19/node_modules/vite/dist/node/chunks/dep-D_zLpgQd.js:49253:16
    - text: ") at normalizeUrl (file:"
    - generic [ref=e13] [cursor=pointer]: ///Users/admin/git/powergit/node_modules/.pnpm/vite@5.4.20_@types+node@20.19.19/node_modules/vite/dist/node/chunks/dep-D_zLpgQd.js:64306:23
    - text: ) at process.processTicksAndRejections (node:internal
    - generic [ref=e14] [cursor=pointer]: /process/task_queues:105:5
    - text: ") at async file:"
    - generic [ref=e15] [cursor=pointer]: ///Users/admin/git/powergit/node_modules/.pnpm/vite@5.4.20_@types+node@20.19.19/node_modules/vite/dist/node/chunks/dep-D_zLpgQd.js:64438:39
    - text: "at async Promise.all (index 4) at async TransformPluginContext.transform (file:"
    - generic [ref=e16] [cursor=pointer]: ///Users/admin/git/powergit/node_modules/.pnpm/vite@5.4.20_@types+node@20.19.19/node_modules/vite/dist/node/chunks/dep-D_zLpgQd.js:64365:7
    - text: ") at async PluginContainer.transform (file:"
    - generic [ref=e17] [cursor=pointer]: ///Users/admin/git/powergit/node_modules/.pnpm/vite@5.4.20_@types+node@20.19.19/node_modules/vite/dist/node/chunks/dep-D_zLpgQd.js:49099:18
    - text: ") at async loadAndTransform (file:"
    - generic [ref=e18] [cursor=pointer]: ///Users/admin/git/powergit/node_modules/.pnpm/vite@5.4.20_@types+node@20.19.19/node_modules/vite/dist/node/chunks/dep-D_zLpgQd.js:51977:27
    - text: ") at async viteTransformMiddleware (file:"
    - generic [ref=e19] [cursor=pointer]: ///Users/admin/git/powergit/node_modules/.pnpm/vite@5.4.20_@types+node@20.19.19/node_modules/vite/dist/node/chunks/dep-D_zLpgQd.js:62105:24
  - generic [ref=e20]:
    - text: Click outside, press
    - generic [ref=e21]: Esc
    - text: key, or fix the code to dismiss.
    - text: You can also disable this overlay by setting
    - code [ref=e22]: server.hmr.overlay
    - text: to
    - code [ref=e23]: "false"
    - text: in
    - code [ref=e24]: vite.config.ts
    - text: .
```