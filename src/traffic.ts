/**
 * In-app traffic generator.
 *
 * A background loop that periodically runs a rotating handful of GraphQL
 * operations against the server itself, so the deployed demo always shows
 * live activity — warm machines, non-empty access logs, a steady stream of
 * queries. Enabled on the Fly deployment via ENABLE_TRAFFIC_GENERATOR; off by
 * default so local dev and the test suite never start a background loop.
 */

import { config } from "./config";

const READ_QUERIES = [
  `{ repositories { id name } }`,
  `{ repositories { id issues { number state } } }`,
  `{ repositories { id pullRequests { number state } } }`,
  `{ search(query: "is:open", type: ISSUE) { __typename } }`,
  `{ search(query: "fix", type: PULL_REQUEST) { __typename } }`,
];

async function gql(query: string, variables?: Record<string, unknown>) {
  const res = await fetch(`${config.trafficTargetUrl}/graphql`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.demoToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

async function readCycle(): Promise<void> {
  // A shuffled handful each cycle so traffic looks organic and, over time,
  // every read query gets exercised.
  const shuffled = [...READ_QUERIES].sort(() => Math.random() - 0.5);
  for (const query of shuffled.slice(0, 3)) {
    try {
      await gql(query);
    } catch (err) {
      console.warn("[traffic] read failed:", (err as Error).message);
    }
  }
}

async function writeCycle(): Promise<void> {
  // Exercise the write path: open an issue on a random repo, then close it.
  // Anything created here is cleared by the nightly reset.
  try {
    const repos: any = await gql(`{ repositories { id } }`);
    const list = repos?.data?.repositories ?? [];
    if (list.length === 0) return;
    const repoId = list[Math.floor(Math.random() * list.length)].id;
    const created: any = await gql(
      `mutation($input: CreateIssueInput!) { createIssue(input: $input) { id } }`,
      { input: { repositoryId: repoId, title: "Traffic-generator check-in" } },
    );
    const issueId = created?.data?.createIssue?.id;
    if (issueId) {
      await gql(`mutation($id: ID!) { closeIssue(id: $id) { id } }`, {
        id: issueId,
      });
    }
  } catch (err) {
    console.warn("[traffic] write cycle failed:", (err as Error).message);
  }
}

export function startTrafficGenerator(): void {
  const intervalMs = config.trafficIntervalSeconds * 1000;
  console.log(
    `[traffic] generator enabled — every ${config.trafficIntervalSeconds}s against ${config.trafficTargetUrl}`,
  );
  let cycle = 0;
  setInterval(async () => {
    cycle += 1;
    await readCycle();
    // Every fifth cycle also exercises a create + close.
    if (cycle % 5 === 0) await writeCycle();
  }, intervalMs);
}
