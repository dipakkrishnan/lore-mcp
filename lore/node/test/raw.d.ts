// Vite's `?raw` import: the file's text, inlined when the test is bundled
// (workerd has no host filesystem to read it from at run time).
declare module "*.jsonc?raw" {
  const text: string;
  export default text;
}
