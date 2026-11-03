// Guard (#18), never imported, so never bundled. If Node types leak into tsconfig.json, `process`
// resolves, the directive below goes unused, and typecheck fails (TS2578).
// @ts-expect-error -- `process` must not resolve in browser code
export type NodeGlobalsLeak = typeof process;
