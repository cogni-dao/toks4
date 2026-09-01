// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { createServer } from "node:http";

const host = process.env.HOST ?? process.env.HOSTNAME ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "9100", 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer from 1 through 65535");
}

const payload = JSON.stringify({
  service: "echo-sidecar",
  status: "ok",
  bindHost: host,
  port,
});

const server = createServer((request, response) => {
  const status = request.url === "/" || request.url === "/livez" ? 200 : 404;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
});

server.listen(port, host, () => {
  console.log(
    JSON.stringify({ event: "echo_sidecar.listening", host, port })
  );
});
