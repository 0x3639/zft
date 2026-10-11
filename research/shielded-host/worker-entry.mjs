import manifest from "./build/candidate/asset-manifest.json";
import { handle } from "./worker.mjs";
export default { fetch: (request, env) => handle(request, env, manifest) };
