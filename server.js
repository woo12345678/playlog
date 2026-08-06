import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4176);
const types = { '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8' };
http.createServer(async (request,response)=>{try{const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);let file=path.join(root,pathname==='/'?'index.html':pathname.slice(1));if(!file.startsWith(root))throw new Error();if((await stat(file)).isDirectory())file=path.join(file,'index.html');response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});response.end(await readFile(file));}catch{response.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});response.end('찾을 수 없습니다.');}}).listen(port,'127.0.0.1',()=>console.log(`PLAYLOG: http://127.0.0.1:${port}`));
