# syntax=docker/dockerfile:1
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2026 Cogni-DAO

FROM node:22-alpine

WORKDIR /app
COPY --chown=node:node server.mjs ./server.mjs

ENV HOST=0.0.0.0
ENV PORT=9100

USER node
EXPOSE 9100

HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:9100/readyz >/dev/null || exit 1

CMD ["node", "server.mjs"]
