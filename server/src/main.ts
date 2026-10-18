import { createServer } from 'http';
import { VERSION } from '@fps/shared';

const PORT = 8080;

const server = createServer((_req, res) => {
  res.writeHead(200);
  res.end(`FPS Server v${VERSION}`);
});

server.listen(PORT, () => {
  console.log(`listening ${PORT}`);
});
