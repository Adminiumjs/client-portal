/// <reference types="vite/client" />

/**
 * The build-time flags, declared so they can be read with DOT access.
 *
 * Dot access is not a style choice: `vite.config.ts` defines each of these via
 * `define`, which matches on the expression TEXT — `import.meta.env.VITE_X`
 * matches, `import.meta.env["VITE_X"]` does not. Without the declaration below
 * TypeScript rejects the dot form on `ImportMetaEnv`'s index signature, and the
 * bracket workaround silently costs the constant folding these flags exist for.
 */
interface ImportMetaEnv {
  readonly VITE_ADMINIUM_SURFACE_SIDE?: string;
  readonly VITE_ADMINIUM_API_BASE_URL?: string;
  readonly VITE_ADMINIUM_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
