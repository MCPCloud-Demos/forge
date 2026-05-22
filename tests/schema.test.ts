/**
 * Schema-shape tests — no database required.
 *
 * These assert the "before" state MCPCloud ingests: 19 operations, and
 * deliberately terse SDL descriptions (most absent, a few one-word).
 */

import { describe, expect, test } from "bun:test";
import { buildSchema } from "graphql";

import { typeDefs } from "../src/schema";

const schema = buildSchema(typeDefs);
const queries = schema.getQueryType()!.getFields();
const mutations = schema.getMutationType()!.getFields();

describe("Forge GraphQL schema", () => {
  test("exposes 9 queries and 10 mutations (19 operations)", () => {
    expect(Object.keys(queries)).toHaveLength(9);
    expect(Object.keys(mutations)).toHaveLength(10);
  });

  test("operation descriptions are terse — most absent", () => {
    const all = [...Object.values(queries), ...Object.values(mutations)];
    const described = all.filter((f) => f.description);
    // Far more operations carry no description than carry one.
    expect(described.length).toBeLessThan(all.length / 2);
  });

  test("the few descriptions that exist are one-liners (the enrichment 'before')", () => {
    expect(mutations.mergePullRequest.description).toBe("Merge.");
    expect(mutations.closeIssue.description).toBe("Close.");
    expect(queries.search.description).toBe("Search.");
    expect(queries.repository.description).toBe("A repository.");
    expect(mutations.createIssue.description).toBeFalsy();
  });

  test("nine core entity types are present in the graph", () => {
    for (const name of [
      "Repository",
      "Issue",
      "PullRequest",
      "Review",
      "Comment",
      "Label",
      "Branch",
      "Commit",
      "User",
    ]) {
      expect(schema.getType(name)).toBeDefined();
    }
  });
});
