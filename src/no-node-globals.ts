// Guard (#18): Node's global types must not reach browser code. Never imported, so never bundled;
// if Node types leak into tsconfig.json, the directive below goes unused and typecheck fails (TS2578).
// @ts-expect-error -- `process` is Node-only and must not resolve here
export type NodeGlobalsLeak = typeof process;
