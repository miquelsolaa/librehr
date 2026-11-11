// TypeScript 6 checks side-effect imports by default (noUncheckedSideEffectImports).
// Next.js 15 only ships declarations for CSS Modules, so plain global stylesheets
// imported for their side effects (e.g. `import "../globals.css"`) need this.
// The body is empty on purpose: global CSS exports nothing.
declare module "*.css" {}
