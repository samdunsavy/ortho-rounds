/* Maps a request URL path to either a file under a public directory, or a
   redirect.

   A bare directory URL like /v2 MUST redirect to /v2/ rather than serving
   /v2/index.html directly. Serving it directly leaves the browser's base
   URL at /v2, so the document's relative references resolve one level too
   high: css/tokens.css becomes /css/tokens.css (404, page renders
   completely unstyled) and app.js becomes /app.js — which in this repo is
   the MAIN app's script, loaded into the v2 shell. That combination looks
   like a totally broken page, and it is why every static server redirects
   directory URLs instead of serving their index in place.

   Returns { file } or { redirect }; exactly one is set. */

import path from 'node:path';
import { existsSync, statSync } from 'node:fs';

export function resolveStaticPath(urlPath, publicDir){
  if(!urlPath || urlPath === '/') return { file: '/index.html' };
  if(urlPath.endsWith('/')) return { file: urlPath + 'index.html' };
  if(path.extname(urlPath)) return { file: urlPath };
  const asDir = path.join(publicDir, urlPath);
  if(existsSync(asDir) && statSync(asDir).isDirectory()){
    return { redirect: urlPath + '/' };
  }
  return { file: urlPath };
}
