// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@shared/readiness/required-private-services`
 * Purpose: Assert this node's Git-declared REQUIRED private sibling services are
 *   bound and serving, as part of ordinary readiness.
 * Scope: Reads the generated service-binding env var, performs one bounded HTTP
 *   request per required sibling, and validates the response.
 * Invariants: FATAL_LOCAL_DEPENDENCY — a private sibling declared in this node's
 *   own service bundle runs in the SAME deployment unit (one Akash lease / one
 *   pod group). It is local serving readiness, not remote async substrate, so it
 *   is fatal to /readyz. This is deliberately unlike Temporal / scheduler-worker
 *   / EVM RPC, which stay non-fatal precisely because they are remote and shared
 *   (incident 2026-06-26: a shared-substrate blip drained the whole fleet).
 *   NO_FALLBACK_URL — an unmaterialized binding is a failure, not a skip; that is
 *   what proves the Git-declared private DNS binding actually reached the runtime.
 * Side-effects: HTTP request to the private deployment network.
 * Links: story.5016, task.5067, src/app/(infra)/readyz/route.ts
 * @public
 */

import { z } from "zod";
import { InfraConnectivityError } from "@/shared/env/invariants";

const REQUEST_TIMEOUT_MS = 3_000;

const echoSidecarResponseSchema = z
  .object({
    service: z.literal("echo-sidecar"),
    status: z.literal("ok"),
    bindHost: z.literal("0.0.0.0"),
    port: z.literal(9100),
  })
  .strict();

/**
 * Every private sibling this node declares as required in its service bundle.
 * The binding env var is generated from the Git-owned `bindings` block, so the
 * expected target is fixed — a different value means the wrong topology shipped.
 */
const REQUIRED_PRIVATE_SERVICES = [
  {
    binding: "ECHO_SIDECAR_URL",
    expectedTarget: "http://echo-sidecar:9100",
    schema: echoSidecarResponseSchema,
  },
] as const;

/** Throws InfraConnectivityError (→ 503) unless every required sibling serves. */
export async function assertRequiredPrivateServices(): Promise<void> {
  for (const service of REQUIRED_PRIVATE_SERVICES) {
    const target = process.env[service.binding];
    if (target !== service.expectedTarget) {
      throw new InfraConnectivityError(
        `required private service binding ${service.binding} is not materialized ` +
          `(expected ${service.expectedTarget}, got ${target ?? "unset"})`
      );
    }

    let body: unknown;
    try {
      const response = await fetch(target, {
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      body = await response.json();
    } catch (error) {
      throw new InfraConnectivityError(
        `required private service ${service.binding} (${target}) is unreachable: ` +
          `${error instanceof Error ? error.message : "unknown error"}`
      );
    }

    const parsed = service.schema.safeParse(body);
    if (!parsed.success) {
      throw new InfraConnectivityError(
        `required private service ${service.binding} (${target}) returned an unexpected response`
      );
    }
  }
}
