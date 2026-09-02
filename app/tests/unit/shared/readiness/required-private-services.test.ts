// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InfraConnectivityError } from "@/shared/env/invariants";
import { assertRequiredPrivateServices } from "@/shared/readiness/required-private-services";

const BINDING = "ECHO_SIDECAR_URL";
const TARGET = "http://echo-sidecar:9100";
const HEALTHY = {
  service: "echo-sidecar",
  status: "ok",
  bindHost: "0.0.0.0",
  port: 9100,
};

function respondWith(body: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 503,
      json: async () => body,
    })
  );
}

describe("assertRequiredPrivateServices", () => {
  beforeEach(() => {
    vi.stubEnv(BINDING, TARGET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("resolves when the declared private sibling serves its expected response", async () => {
    respondWith(HEALTHY);
    await expect(assertRequiredPrivateServices()).resolves.toBeUndefined();
  });

  it("fails when the binding was never materialized", async () => {
    vi.stubEnv(BINDING, "");
    respondWith(HEALTHY);
    await expect(assertRequiredPrivateServices()).rejects.toBeInstanceOf(
      InfraConnectivityError
    );
  });

  it("fails when the binding points somewhere other than the declared target", async () => {
    vi.stubEnv(BINDING, "http://localhost:9100");
    respondWith(HEALTHY);
    await expect(assertRequiredPrivateServices()).rejects.toBeInstanceOf(
      InfraConnectivityError
    );
  });

  it("fails when the private sibling is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(assertRequiredPrivateServices()).rejects.toBeInstanceOf(
      InfraConnectivityError
    );
  });

  it("fails when the private sibling answers with an unexpected shape", async () => {
    respondWith({ service: "something-else", status: "ok" });
    await expect(assertRequiredPrivateServices()).rejects.toBeInstanceOf(
      InfraConnectivityError
    );
  });
});
