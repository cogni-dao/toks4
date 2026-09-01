// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/(infra)/deployment-proof/route";

describe("GET /deployment-proof", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("proves the exact Git-declared private service binding", async () => {
    vi.stubEnv("ECHO_SIDECAR_URL", "http://echo-sidecar:9100");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          service: "echo-sidecar",
          status: "ok",
          bindHost: "0.0.0.0",
          port: 9100,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      binding: "ECHO_SIDECAR_URL",
      target: "http://echo-sidecar:9100",
      sidecar: {
        service: "echo-sidecar",
        status: "ok",
        bindHost: "0.0.0.0",
        port: 9100,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://echo-sidecar:9100", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
  });

  it("fails closed when the binding was not materialized", async () => {
    vi.stubEnv("ECHO_SIDECAR_URL", "http://wrong-service:9100");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "unavailable",
      reason: "binding_not_materialized",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
