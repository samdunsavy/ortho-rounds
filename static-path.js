/* Maps a request URL path to a file path relative to a public directory.
   Directory URLs (with or without a trailing slash) resolve to their
   index.html so /v2 and /v2/ both serve <publicDir>/v2/index.html.
   Anything carrying a file extension is returned untouched. */

import path from 'node:path';
import { existsSync, statSync } from 'node:fs';

export function resolveStaticPath(urlPath, publicDir){
  if(!urlPath || urlPath === '/') return '/index.html';
  if(urlPath.endsWith('/')) return urlPath + 'index.html';
  if(path.extname(urlPath)) return urlPath;
  const asDir = path.join(publicDir, urlPath);
  if(existsSync(asDir) && statSync(asDir).isDirectory()) return urlPath + '/index.html';
  return urlPath;
}
