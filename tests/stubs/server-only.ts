/**
 * `server-only` is resolved by Next's bundler, not by npm, so a plain Node
 * test runner cannot import a module that declares it.
 *
 * Aliasing it to this empty module lets the tests exercise server modules
 * directly. The guard itself is unaffected: it exists to fail a CLIENT bundle
 * at build time, and vitest is neither.
 */
export {};
