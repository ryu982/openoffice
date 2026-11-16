/** The build bundles the print layout worker as its own chunk and returns its runtime path. */
declare module '*/print-layout-worker?modulePath' {
  const path: string
  export default path
}
