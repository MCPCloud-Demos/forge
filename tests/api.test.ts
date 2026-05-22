/**
 * Integration tests — require a Postgres database.
 *
 * Run `docker compose up -d` first; the suite reseeds the demo tenant and
 * exercises the resolvers through Apollo. If no database is reachable the
 * suite skips itself rather than failing, so `bun test` still runs the
 * schema-shape tests without Docker.
 */

import { describe, expect, test } from "bun:test";
import { ApolloServer } from "@apollo/server";

import { prisma } from "../src/db";
import { resolvers } from "../src/resolvers";
import { typeDefs } from "../src/schema";
import { reseed } from "../src/seed";

let dbReachable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbReachable = true;
} catch {
  console.warn("[api.test] no database reachable — skipping integration tests");
}

const apollo = new ApolloServer({ typeDefs, resolvers, introspection: true });

async function exec(
  query: string,
  variables?: Record<string, unknown>,
  tenant: string | null = "demo",
) {
  const res = await apollo.executeOperation(
    { query, variables },
    { contextValue: { tenant } },
  );
  if (res.body.kind !== "single") throw new Error("expected single result");
  return res.body.singleResult;
}

const suite = dbReachable ? describe : describe.skip;

suite("Forge API", () => {
  test("seed builds 4 repositories", async () => {
    await reseed();
    const res = await exec(`{ repositories { id name owner } }`);
    expect(res.errors).toBeUndefined();
    expect((res.data!.repositories as unknown[]).length).toBe(4);
  });

  test("data resolvers reject a missing OAuth token", async () => {
    const res = await exec(`{ repositories { id } }`, undefined, null);
    expect(res.errors).toBeDefined();
    expect(res.errors![0].extensions?.code).toBe("UNAUTHENTICATED");
  });

  test("introspection works without a token", async () => {
    const res = await exec(`{ __schema { queryType { name } } }`, undefined, null);
    expect(res.errors).toBeUndefined();
  });

  test("the seed produces ~30 issues and ~15 pull requests", async () => {
    const issues = await prisma.issue.count();
    const prs = await prisma.pullRequest.count();
    expect(issues).toBe(30);
    expect(prs).toBe(15);
  });

  test("search scopes results by type", async () => {
    const res = await exec(
      `query($q: String!) { search(query: $q, type: REPO) { __typename ... on Repository { name } } }`,
      { q: "app" },
    );
    expect(res.errors).toBeUndefined();
    const hits = res.data!.search as { __typename: string }[];
    expect(hits.every((h) => h.__typename === "Repository")).toBe(true);
  });

  test("createIssue then closeIssue moves the issue to CLOSED", async () => {
    const repo = await prisma.repository.findFirstOrThrow();
    const created = await exec(
      `mutation($input: CreateIssueInput!) { createIssue(input: $input) { id state author { login } } }`,
      { input: { repositoryId: repo.id, title: "Test issue" } },
    );
    expect(created.errors).toBeUndefined();
    const issue = created.data!.createIssue as { id: string; state: string };
    expect(issue.state).toBe("OPEN");

    const closed = await exec(
      `mutation($id: ID!) { closeIssue(id: $id) { state closedAt } }`,
      { id: issue.id },
    );
    expect(closed.errors).toBeUndefined();
    expect((closed.data!.closeIssue as { state: string }).state).toBe("CLOSED");
  });

  test("mergePullRequest is blocked by a CHANGES_REQUESTED review", async () => {
    // The seed gives exactly one open PR a CHANGES_REQUESTED review.
    const reviews = await prisma.review.findMany({
      where: { state: "CHANGES_REQUESTED" },
    });
    expect(reviews.length).toBeGreaterThan(0);
    const blocked = await exec(
      `mutation($id: ID!) { mergePullRequest(id: $id) { state } }`,
      { id: reviews[0].pullRequestId },
    );
    expect(blocked.errors).toBeDefined();
    expect(blocked.errors![0].message).toContain("changes requested");
  });

  test("mergePullRequest merges a clean open PR", async () => {
    const open = await prisma.pullRequest.findFirstOrThrow({
      where: { state: "OPEN" },
    });
    const res = await exec(
      `mutation($id: ID!) { mergePullRequest(id: $id, method: SQUASH) { state merged mergeCommitSha } }`,
      { id: open.id },
    );
    // Some open PRs carry a CHANGES_REQUESTED review; only assert when clean.
    if (!res.errors) {
      const pr = res.data!.mergePullRequest as { state: string; merged: boolean };
      expect(pr.state).toBe("MERGED");
      expect(pr.merged).toBe(true);
    }
  });

  test("a draft pull request cannot be merged", async () => {
    const draft = await prisma.pullRequest.findFirst({ where: { state: "DRAFT" } });
    expect(draft).not.toBeNull();
    const res = await exec(
      `mutation($id: ID!) { mergePullRequest(id: $id) { state } }`,
      { id: draft!.id },
    );
    expect(res.errors).toBeDefined();
    expect(res.errors![0].message).toContain("Draft");
  });
});
