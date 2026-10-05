declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
declare module "*.woff" {
  const data: ArrayBuffer;
  export default data;
}
