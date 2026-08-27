// Ambient declarations for CSS side-effect imports (including dynamic
// `import("...styles.css")`), which carry no type information. Without this,
// `tsc`/`next build` fails to resolve modules like
// "@aws-amplify/ui-react/styles.css".
declare module "*.css";
