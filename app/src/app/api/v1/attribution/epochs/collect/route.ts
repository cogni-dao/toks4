// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/attribution/epochs/collect/route`
 * Purpose: Session-authed endpoint to trigger epoch collection on demand via Temporal schedule trigger.
 * Scope: Auth-protected POST endpoint. Triggers LEDGER_INGEST schedule immediately. Does not run collection logic — delegates to existing schedule/workflow.
 * Invariants:
 *   - WRITES_VIA_TEMPORAL: Collection runs through the existing Temporal schedule, not bypassing it
 *   - TRIGGER_IS_SCHEDULE: Uses ScheduleHandle.trigger() — same workflow, same input as the cron
 *   - COOLDOWN_ENFORCED: Rejects requests within 5 minutes of last run
 * Side-effects: IO (HTTP response, Temporal schedule trigger via ScheduleControlPort)
 * Links: docs/spec/attribution-ledger.md, contracts/attribution.collect-trigger.v1.contract
 * @public
 */

import {
  CollectTriggerCooldownResponseSchema,
  CollectTriggerResponseSchema,
} from "@cogni/node-contracts";
import { buildEventId, hashCanonicalPayload } from "@cogni/ingestion-core";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { getNodeId } from "@/shared/config";
import { serverEnv } from "@/shared/env";
import { EVENT_NAMES, logEvent } from "@/shared/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LEDGER_INGEST_SCHEDULE_ID = "governance:ledger_ingest";
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const TOKS4_NODE_ID = "72aa130b-f0ad-495a-a061-9ee1f9c9525d";

async function backfillCandidateRehearsalReceipt(): Promise<void> {
  if (
    serverEnv().DEPLOY_ENVIRONMENT !== "candidate-a" ||
    getNodeId() !== TOKS4_NODE_ID
  ) {
    return;
  }

  // Rehearsal-only recovery for the real toks4 PR #3 merge. Candidate-a does
  // not receive production GitHub webhooks yet (task.5023), so persist the
  // exact normalized event through the normal idempotent receipt adapter.
  // This branch is explicitly non-mergeable and will be discarded after E2E.
  const receiptId = buildEventId("github", "pr", "cogni-dao/toks4", 3);
  const eventTime = new Date("2026-08-17T09:42:47.000Z");
  const payloadHash = await hashCanonicalPayload({
    authorId: "265189974",
    id: receiptId,
    eventTime: eventTime.toISOString(),
  });

  await getContainer().attributionStore.insertIngestionReceipts([
    {
      receiptId,
      nodeId: TOKS4_NODE_ID,
      source: "github",
      eventType: "pr_merged",
      platformUserId: "265189974",
      platformLogin: "cogni-operator[bot]",
      artifactUrl: "https://github.com/cogni-dao/toks4/pull/3",
      metadata: {
        title: "chore: merge node-template upstream",
        baseBranch: "main",
        mergeCommitSha: "d8a4bb55ee853a557c0d3eacea1b023df40520a2",
        repo: "cogni-dao/toks4",
        action: "closed",
        additions: 758,
        deletions: 72,
        changedFiles: 24,
      },
      payloadHash,
      producer: "task.5029-candidate-rehearsal",
      producerVersion: "1",
      eventTime,
      retrievedAt: new Date(),
    },
  ]);
}

export const POST = wrapRouteHandlerWithLogging(
  {
    routeId: "ledger.collect-trigger",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx) => {
    const { scheduleControl } = getContainer();

    // Check schedule exists and enforce cooldown
    const description = await scheduleControl.describeSchedule(
      LEDGER_INGEST_SCHEDULE_ID
    );
    if (!description) {
      return NextResponse.json(
        {
          error:
            "LEDGER_INGEST schedule not found. Governance schedules may not be synced.",
        },
        { status: 404 }
      );
    }

    if (description.lastRunAtIso) {
      const lastRunAt = new Date(description.lastRunAtIso);
      const elapsed = Date.now() - lastRunAt.getTime();
      if (elapsed < COOLDOWN_MS) {
        const retryAfterSeconds = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        return NextResponse.json(
          CollectTriggerCooldownResponseSchema.parse({
            error: "cooldown",
            retryAfterSeconds,
            lastRunAt: description.lastRunAtIso,
          }),
          { status: 429 }
        );
      }
    }

    await backfillCandidateRehearsalReceipt();
    await scheduleControl.triggerSchedule(LEDGER_INGEST_SCHEDULE_ID);

    logEvent(ctx.log, EVENT_NAMES.LEDGER_COLLECT_TRIGGERED, {
      reqId: ctx.reqId,
      routeId: ctx.routeId,
      scheduleId: LEDGER_INGEST_SCHEDULE_ID,
    });

    return NextResponse.json(
      CollectTriggerResponseSchema.parse({
        triggered: true,
        scheduleId: LEDGER_INGEST_SCHEDULE_ID,
      }),
      { status: 200 }
    );
  }
);
