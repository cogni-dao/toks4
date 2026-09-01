// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/deployment-proof`
 * Purpose: Disposable task.5067 endpoint proving the public app can reach its
 *   private sibling through the Git-declared service binding.
 * Scope: Reads the generated binding URL, performs one bounded HTTP request,
 *   validates the sibling response, and returns a small proof document.
 * Invariants: No fallback URL; missing binding or failed private DNS/network is
 *   visible as a 503. This route exists only on the unmerged toks4 proof PR.
 * Side-effects: HTTP request to the private deployment network.
 * Links: story.5016, task.5067
 * @public
 */

import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const sidecarResponseSchema = z
  .object({
    service: z.literal("echo-sidecar"),
    status: z.literal("ok"),
    bindHost: z.literal("0.0.0.0"),
    port: z.literal(9100),
  })
  .strict();

const proofResponseSchema = z
  .object({
    status: z.literal("ok"),
    binding: z.literal("ECHO_SIDECAR_URL"),
    target: z.literal("http://echo-sidecar:9100"),
    sidecar: sidecarResponseSchema,
  })
  .strict();

export async function GET(): Promise<NextResponse> {
  const target = process.env.ECHO_SIDECAR_URL;
  if (target !== "http://echo-sidecar:9100") {
    return NextResponse.json(
      { status: "unavailable", reason: "binding_not_materialized" },
      { status: 503 }
    );
  }

  try {
    const response = await fetch(target, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`sidecar returned HTTP ${response.status}`);

    const sidecar = sidecarResponseSchema.parse(await response.json());
    const proof = proofResponseSchema.parse({
      status: "ok",
      binding: "ECHO_SIDECAR_URL",
      target,
      sidecar,
    });
    return NextResponse.json(proof);
  } catch {
    return NextResponse.json(
      { status: "unavailable", reason: "private_service_unreachable" },
      { status: 503 }
    );
  }
}
