// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/meta/node-local-manifest-identity`
 * Purpose: Keep node-owned ExternalSecret identities aligned with repo-spec identity.
 * Scope: Reads committed repo-spec and node-local manifests; does not contact Kubernetes or a secret store.
 * Invariants: Every environment names the ExternalSecret, target Secret, component label, and OpenBao path from the node slug.
 * Side-effects: IO (read-only filesystem)
 * Links: .cogni/repo-spec.yaml, k8s/external-secrets
 * @internal
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseRepoSpec } from "@cogni/repo-spec";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const ENVIRONMENTS = [
  "candidate-a",
  "candidate-b",
  "preview",
  "production",
] as const;

type ExternalSecretManifest = {
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
  };
  spec?: {
    target?: { name?: string };
    dataFrom?: Array<{ extract?: { key?: string } }>;
  };
};

describe("node-local ExternalSecret identity", () => {
  const repoSpec = parseRepoSpec(
    readFileSync(join(REPO_ROOT, ".cogni/repo-spec.yaml"), "utf8")
  );
  const nodeSlug = repoSpec.intent.name;

  it.each(ENVIRONMENTS)(
    "derives every %s identity field from repo-spec",
    (environment) => {
      const manifestPath = join(
        REPO_ROOT,
        "k8s",
        "external-secrets",
        environment,
        "external-secret.yaml"
      );
      const manifest = parse(
        readFileSync(manifestPath, "utf8")
      ) as ExternalSecretManifest;
      const expectedSecretName = `${nodeSlug}-env-secrets`;

      expect(manifest.metadata?.name).toBe(expectedSecretName);
      expect(manifest.metadata?.namespace).toBe(`cogni-${environment}`);
      expect(manifest.metadata?.labels?.["app.kubernetes.io/component"]).toBe(
        nodeSlug
      );
      expect(manifest.spec?.target?.name).toBe(expectedSecretName);
      expect(manifest.spec?.dataFrom?.[0]?.extract?.key).toBe(
        `${environment}/${nodeSlug}`
      );
    }
  );
});
