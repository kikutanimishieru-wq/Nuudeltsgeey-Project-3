const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
http.createServer((req,res)=>{
  let name;
  try { name = decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch {res.writeHead(400);return res.end('Bad request');}
  const file = path.resolve(root, '.' + (name==='/'?'/index.html':name));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end('Forbidden');}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(data);});
}).listen(5173,'127.0.0.1',()=>console.log('eNomad Arena: http://localhost:5173'));
