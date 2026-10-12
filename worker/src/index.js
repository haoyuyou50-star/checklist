import { createHandler } from "./handler.js";
const handle = createHandler();
export default { fetch: (req, env) => handle(req, env) };
