// Set at build time in vite.config.ts

/** package.json version, e.g. 1.0.0 */
declare const __APP_VERSION__: string
/** Short commit hash, or empty when built outside Git */
declare const __APP_COMMIT__: string
/** ISO timestamp of the build */
declare const __APP_BUILT_AT__: string
