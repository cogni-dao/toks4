// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getContainer: vi.fn(),
  verifySystemTenant: vi.fn(),
  serverEnv: vi.fn(),
  assertRuntimeSecrets: vi.fn(),
  assertTemporalConnectivity: vi.fn(),
  assertSchedulerWorkerConnectivity: vi.fn(),
  checkEvmRpcConnectivity: vi.fn(),
  assertRequiredPrivateServices: vi.fn(),
  setBuildInfo: vi.fn(),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@/bootstrap/container", () => ({
  getContainer: mocks.getContainer,
}));

vi.mock("@/bootstrap/healthchecks", () => ({
  verifySystemTenant: mocks.verifySystemTenant,
}));

vi.mock("@/bootstrap/http", () => ({
  wrapRouteHandlerWithLogging:
    (
      _options: unknown,
      handler: (ctx: unknown, request: NextRequest) => Promise<Response>
    ) =>
    (request: NextRequest) =>
      handler({ log: mocks.log }, request),
}));

vi.mock("@/shared/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/env")>();
  return {
    ...actual,
    serverEnv: mocks.serverEnv,
  };
});

vi.mock("@/shared/env/invariants", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/shared/env/invariants")>();
  return {
    ...actual,
    assertRuntimeSecrets: mocks.assertRuntimeSecrets,
    assertTemporalConnectivity: mocks.assertTemporalConnectivity,
    assertSchedulerWorkerConnectivity: mocks.assertSchedulerWorkerConnectivity,
    checkEvmRpcConnectivity: mocks.checkEvmRpcConnectivity,
  };
});

vi.mock("@/shared/readiness/required-private-services", () => ({
  assertRequiredPrivateServices: mocks.assertRequiredPrivateServices,
}));

vi.mock("@/shared/observability/server/metrics", () => ({
  setBuildInfo: mocks.setBuildInfo,
}));

import { GET } from "@/app/(infra)/readyz/route";
import { InfraConnectivityError } from "@/shared/env/invariants";

type SubstrateFailure = {
  dependency: "temporal" | "scheduler-worker";
  event: string;
  fail: () => void;
};

describe("GET /readyz async substrate semantics", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.serverEnv.mockReturnValue({
      APP_BUILD_SHA: "fbcbaee8f43a57b094bf51a95e4c38248e0515bb",
    });
    mocks.getContainer.mockReturnValue({
      paymentRailsActive: false,
      scheduleControl: {},
      serviceAccountService: {},
    });
    mocks.assertTemporalConnectivity.mockResolvedValue(undefined);
    mocks.assertSchedulerWorkerConnectivity.mockResolvedValue(undefined);
    mocks.assertRequiredPrivateServices.mockResolvedValue(undefined);
    mocks.verifySystemTenant.mockResolvedValue(undefined);
  });

  const substrateFailures: SubstrateFailure[] = [
    {
      dependency: "temporal",
      event: "substrate.temporal.unreachable",
      fail: () => {
        mocks.assertTemporalConnectivity.mockRejectedValue(
          new InfraConnectivityError("Temporal unavailable")
        );
      },
    },
    {
      dependency: "scheduler-worker",
      event: "substrate.scheduler_worker.unreachable",
      fail: () => {
        mocks.assertSchedulerWorkerConnectivity.mockRejectedValue(
          new InfraConnectivityError("scheduler-worker unavailable")
        );
      },
    },
  ];

  // The required private sibling shares this deployment unit, so unlike the
  // remote shared substrate above it is FATAL to the ordinary probe — that is
  // what lets plain /readyz stand in as the private-networking deploy gate.
  it("fails shallow readiness when a required private sibling is unreachable", async () => {
    mocks.assertRequiredPrivateServices.mockRejectedValue(
      new InfraConnectivityError("echo-sidecar unreachable")
    );

    const response = await GET(new NextRequest("http://localhost:3000/readyz"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "error",
      reason: "INFRA_UNREACHABLE",
    });
  });

  it.each(substrateFailures)(
    "keeps shallow readiness healthy when $dependency is absent",
    async ({ dependency, event, fail }) => {
      fail();

      const response = await GET(
        new NextRequest("http://localhost:3000/readyz")
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: "healthy",
        buildSha: "fbcbaee8f43a57b094bf51a95e4c38248e0515bb",
      });
      expect(mocks.log.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event,
          severity: "critical",
          reason: "INFRA_UNREACHABLE",
          dependency,
        }),
        expect.stringContaining("Returning ready")
      );
    }
  );

  it.each(substrateFailures)(
    "hard-fails deep readiness when $dependency is absent",
    async ({ fail }) => {
      fail();

      const response = await GET(
        new NextRequest("http://localhost:3000/readyz?deep=1")
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        status: "error",
        reason: "INFRA_UNREACHABLE",
      });
    }
  );
});
