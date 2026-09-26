import { handleRequest, type Ctx, type Env } from './handler.ts';

/** Cloudflare Worker entry point. */
export default {
  fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
};
