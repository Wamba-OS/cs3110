const http = require("http");
const fs   = require("fs");
const path = require("path");

const MIME_TYPES = {
  ".html": "text/html",
  ".css":  "text/css",
  ".js":   "text/javascript",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".svg":  "image/svg+xml",
};

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  let filePath = "." + req.url;

  if (filePath === "./") filePath = "./index.html";

  const ext  = path.extname(filePath);
  const mime = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});