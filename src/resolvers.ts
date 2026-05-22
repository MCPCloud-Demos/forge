/**
 * Forge GraphQL resolvers.
 *
 * Nine queries and ten mutations over a GitHub-style dev platform graph
 * (Repository → Issue / PullRequest → Review / Comment). Every data resolver
 * requires a valid OAuth bearer token; the demo is single-tenant ("demo").
 */

import { GraphQLError, GraphQLScalarType, Kind } from "graphql";

import { type ForgeContext, requireAuth } from "./auth";
import { prisma } from "./db";
import { newId, newSha } from "./ids";

// --- helpers --------------------------------------------------------------

function fail(message: string, code = "BAD_REQUEST", status = 409): never {
  throw new GraphQLError(message, {
    extensions: { code, http: { status } },
  });
}

/** Issues and pull requests share one number sequence per repository. */
async function nextNumber(repositoryId: string): Promise<number> {
  const [lastIssue, lastPr] = await Promise.all([
    prisma.issue.findFirst({
      where: { repositoryId },
      orderBy: { number: "desc" },
    }),
    prisma.pullRequest.findFirst({
      where: { repositoryId },
      orderBy: { number: "desc" },
    }),
  ]);
  return Math.max(lastIssue?.number ?? 0, lastPr?.number ?? 0) + 1;
}

/** Latest review per author — true when anyone's latest is CHANGES_REQUESTED. */
async function hasUnresolvedChanges(pullRequestId: string): Promise<boolean> {
  const reviews = await prisma.review.findMany({
    where: { pullRequestId },
    orderBy: { createdAt: "asc" },
  });
  const latestByAuthor = new Map<string, string>();
  for (const review of reviews) latestByAuthor.set(review.authorId, review.state);
  return [...latestByAuthor.values()].includes("CHANGES_REQUESTED");
}

async function loadSubject(subjectId: string) {
  const issue = await prisma.issue.findUnique({ where: { id: subjectId } });
  if (issue) return { kind: "ISSUE" as const, issue };
  const pr = await prisma.pullRequest.findUnique({ where: { id: subjectId } });
  if (pr) return { kind: "PULL_REQUEST" as const, pr };
  return null;
}

// --- DateTime scalar ------------------------------------------------------

const DateTime = new GraphQLScalarType({
  name: "DateTime",
  description: "An ISO-8601 date-time string.",
  serialize(value) {
    return value instanceof Date ? value.toISOString() : String(value);
  },
  parseValue(value) {
    return new Date(value as string);
  },
  parseLiteral(ast) {
    return ast.kind === Kind.STRING ? new Date(ast.value) : null;
  },
});

// --- resolvers ------------------------------------------------------------

export const resolvers = {
  DateTime,

  Query: {
    async repositories(_p: unknown, args: any, ctx: ForgeContext) {
      const tenant = requireAuth(ctx);
      const filter = args.filter ?? {};
      const repos = await prisma.repository.findMany({
        where: {
          tenantId: tenant,
          ...(filter.owner ? { owner: filter.owner } : {}),
          ...(filter.isPrivate != null ? { isPrivate: filter.isPrivate } : {}),
        },
        orderBy: { stars: "desc" },
      });
      if (!filter.query) return repos;
      const q = String(filter.query).toLowerCase();
      return repos.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q),
      );
    },

    async repository(_p: unknown, args: any, ctx: ForgeContext) {
      const tenant = requireAuth(ctx);
      return prisma.repository.findFirst({
        where: { tenantId: tenant, owner: args.owner, name: args.name },
      });
    },

    async issues(_p: unknown, args: any, ctx: ForgeContext) {
      requireAuth(ctx);
      const filter = args.filter ?? {};
      let issues = await prisma.issue.findMany({
        where: {
          repositoryId: args.repo,
          ...(filter.state ? { state: filter.state } : {}),
          ...(filter.author ? { authorId: filter.author } : {}),
        },
      });
      if (filter.assignee) {
        issues = issues.filter((i) => i.assigneeIds.includes(filter.assignee));
      }
      if (filter.labels?.length) {
        const labels = await prisma.label.findMany({
          where: { repositoryId: args.repo, name: { in: filter.labels } },
        });
        const wanted = new Set(labels.map((l) => l.id));
        issues = issues.filter((i) => i.labelIds.some((id) => wanted.has(id)));
      }
      if (args.sort === "COMMENTS") {
        const counts = new Map<string, number>();
        for (const issue of issues) {
          counts.set(
            issue.id,
            await prisma.comment.count({ where: { subjectId: issue.id } }),
          );
        }
        return issues.sort(
          (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0),
        );
      }
      const key = args.sort === "UPDATED" ? "updatedAt" : "createdAt";
      return issues.sort(
        (a, b) => (b as any)[key].getTime() - (a as any)[key].getTime(),
      );
    },

    async issue(_p: unknown, args: any, ctx: ForgeContext) {
      requireAuth(ctx);
      return prisma.issue.findUnique({ where: { id: args.id } });
    },

    async pullRequests(_p: unknown, args: any, ctx: ForgeContext) {
      requireAuth(ctx);
      const filter = args.filter ?? {};
      let prs = await prisma.pullRequest.findMany({
        where: {
          repositoryId: args.repo,
          ...(filter.state ? { state: filter.state } : {}),
          ...(filter.author ? { authorId: filter.author } : {}),
        },
        orderBy: { createdAt: "desc" },
      });
      if (filter.reviewer) {
        prs = prs.filter((p) => p.reviewerIds.includes(filter.reviewer));
      }
      return prs;
    },

    async pullRequest(_p: unknown, args: any, ctx: ForgeContext) {
      requireAuth(ctx);
      return prisma.pullRequest.findUnique({ where: { id: args.id } });
    },

    async labels(_p: unknown, args: any, ctx: ForgeContext) {
      requireAuth(ctx);
      return prisma.label.findMany({ where: { repositoryId: args.repo } });
    },

    async search(_p: unknown, args: any, ctx: ForgeContext) {
      const tenant = requireAuth(ctx);
      const raw = String(args.query ?? "");
      // Pull `key:value` qualifiers out; the remainder is free text.
      const qualifiers = new Map<string, string>();
      const free = raw
        .replace(/(\w+):(\S+)/g, (_m, k, v) => {
          qualifiers.set(k.toLowerCase(), v.toLowerCase());
          return "";
        })
        .trim()
        .toLowerCase();
      const type: string | null = args.type ?? null;

      const matchText = (...fields: (string | null | undefined)[]) =>
        !free || fields.some((f) => (f ?? "").toLowerCase().includes(free));

      const results: any[] = [];
      const repos = await prisma.repository.findMany({
        where: { tenantId: tenant },
      });
      const repoIds = repos.map((r) => r.id);

      if (type === "REPO" || type == null) {
        for (const r of repos) {
          if (matchText(r.name, r.description, r.owner)) results.push(r);
        }
      }
      if (type === "ISSUE" || type === "PULL_REQUEST" || type == null) {
        const issues = await prisma.issue.findMany({
          where: { repositoryId: { in: repoIds } },
        });
        const prs = await prisma.pullRequest.findMany({
          where: { repositoryId: { in: repoIds } },
        });
        const applyQualifiers = (item: any, isPr: boolean) => {
          if (qualifiers.has("is")) {
            const want = qualifiers.get("is");
            const open = item.state === "OPEN" || item.state === "DRAFT";
            if (want === "open" && !open) return false;
            if (want === "closed" && open) return false;
            if (want === "merged" && item.state !== "MERGED") return false;
            if (want === "draft" && item.state !== "DRAFT") return false;
          }
          if (qualifiers.has("author") && item.authorId !== qualifiers.get("author"))
            return false;
          return true;
        };
        if (type === "ISSUE" || type == null) {
          for (const i of issues) {
            if (matchText(i.title, i.body) && applyQualifiers(i, false))
              results.push(i);
          }
        }
        if (type === "PULL_REQUEST" || type == null) {
          for (const p of prs) {
            if (matchText(p.title, p.body) && applyQualifiers(p, true))
              results.push(p);
          }
        }
      }
      // CODE search has no file index in this demo — it returns no results.
      return results.slice(0, 50);
    },

    async user(_p: unknown, args: any, ctx: ForgeContext) {
      const tenant = requireAuth(ctx);
      return prisma.user.findFirst({
        where: { tenantId: tenant, login: args.login },
      });
    },
  },

  Mutation: {
    async createIssue(_p: unknown, args: any, ctx: ForgeContext) {
      requireAuth(ctx);
      const input = args.input;
      const repo = await prisma.repository.findUnique({
        where: { id: input.repositoryId },
      });
      if (!repo) fail("Repository not found", "NOT_FOUND", 404);
      return prisma.issue.create({
        data: {
          id: newId("issue"),
          repositoryId: input.repositoryId,
          number: await nextNumber(input.repositoryId),
          title: input.title,
          body: input.body ?? null,
          state: "OPEN",
          authorId: ctx.tenant === "demo" ? "demo-actor" : "demo-actor",
          assigneeIds: input.assigneeIds ?? [],
          labelIds: input.labelIds ?? [],
        },
      });
    },

    async updateIssue(_p: unknown, args: any, ctx: ForgeContext) {
      requireAuth(ctx);
      const issue = await prisma.issue.findUnique({ where: { id: args.id } });
      if (!issue) fail("Issue not found", "NOT_FOUND", 404);
      const input = args.input;
      return prisma.issue.update({
        where: { id: args.id },
        data: {
          ...(input.title != null ? { title: input.title } : {}),
          ...(input.body != null ? { body: input.body } : {}),
          ...(input.state ? { state: input.state } : {}),
          ...(input.state === "CLOSED" && !issue.closedAt
            ? { closedAt: new Date() }
            : {}),
          updatedAt: new Date(),
        },
      });
    },

    async closeIssue(_p: unknown, args: any, ctx: ForgeContext) {
      requireAuth(ctx);
      const issue = await prisma.issue.findUnique({ where: { id: args.id } });
      if (!issue) fail("Issue not found", "NOT_FOUND", 404);
      if (issue.state === "CLOSED") fail("Issue is already closed");
      return prisma.issue.update({
        where: { id: args.id },
        data: { state: "CLOSED", closedAt: new Date(), updatedAt: new Date() },
      });
    },

    async addComment(_p: unknown, args: any, ctx: ForgeContext) {
      requireAuth(ctx);
      const subject = await loadSubject(args.subjectId);
      if (!subject) fail("Subject not found", "NOT_FOUND", 404);
      const comment = await prisma.comment.create({
        data: {
          id: newId("comment"),
          subjectId: args.subjectId,
          subjectType: subject.kind,
          authorId: "demo-actor",
          body: args.body,
        },
      });
      if (subject.kind === "ISSUE") {
        await prisma.issue.update({
          where: { id: args.subjectId },
          data: { updatedAt: new Date() },
        });
      } else {
        await prisma.pullRequest.update({
          where: { id: args.subjectId },
          data: { updatedAt: new Date() },
        });
      }
      return comment;
    },

    async addLabels(_p: unknown, args: any, ctx: ForgeContext) {
      requireAuth(ctx);
      const subject = await loadSubject(args.subjectId);
      if (!subject) fail("Subject not found", "NOT_FOUND", 404);
      const current =
        subject.kind === "ISSUE"
          ? subject.issue!.labelIds
          : subject.pr!.labelIds;
      const merged = [...new Set([...current, ...args.labelIds])];
      if (subject.kind === "ISSUE") {
        await prisma.issue.update({
          where: { id: args.subjectId },
          data: { labelIds: merged, updatedAt: new Date() },
        });
      } else {
        await prisma.pullRequest.update({
          where: { id: args.subjectId },
          data: { labelIds: merged, updatedAt: new Date() },
        });
      }
      return prisma.label.findMany({ where: { id: { in: merged } } });
    },

    async createPullRequest(_p: unknown, args: any, ctx: ForgeContext) {
      requireAuth(ctx);
      const input = args.input;
      const repo = await prisma.repository.findUnique({
        where: { id: input.repositoryId },
      });
      if (!repo) fail("Repository not found", "NOT_FOUND", 404);
      return prisma.pullRequest.create({
        data: {
          id: newId("pr"),
          repositoryId: input.repositoryId,
          number: await nextNumber(input.repositoryId),
          title: input.title,
          body: input.body ?? null,
          state: "OPEN",
          authorId: "demo-actor",
          headRef: input.headRef,
          baseRef: input.baseRef,
          checksPassing: true,
        },
      });
    },

    async mergePullRequest(_p: unknown, args: any, ctx: ForgeContext) {
      requireAuth(ctx);
      const pr = await prisma.pullRequest.findUnique({ where: { id: args.id } });
      if (!pr) fail("Pull request not found", "NOT_FOUND", 404);
      if (pr.state === "MERGED") fail("Pull request is already merged");
      if (pr.state === "CLOSED") fail("Pull request is closed");
      if (pr.state === "DRAFT") fail("Draft pull requests cannot be merged");
      if (await hasUnresolvedChanges(pr.id)) {
        fail("Pull request has unresolved review changes requested");
      }
      return prisma.pullRequest.update({
        where: { id: args.id },
        data: {
          state: "MERGED",
          merged: true,
          mergeCommitSha: newSha(),
          mergedAt: new Date(),
          updatedAt: new Date(),
        },
      });
    },

    async requestReview(_p: unknown, args: any, ctx: ForgeContext) {
      requireAuth(ctx);
      const pr = await prisma.pullRequest.findUnique({
        where: { id: args.prId },
      });
      if (!pr) fail("Pull request not found", "NOT_FOUND", 404);
      const user = await prisma.user.findUnique({ where: { id: args.userId } });
      if (!user) fail("User not found", "NOT_FOUND", 404);
      const reviewers = [...new Set([...pr.reviewerIds, args.userId])];
      return prisma.pullRequest.update({
        where: { id: args.prId },
        data: { reviewerIds: reviewers, updatedAt: new Date() },
      });
    },

    async submitReview(_p: unknown, args: any, ctx: ForgeContext) {
      requireAuth(ctx);
      const pr = await prisma.pullRequest.findUnique({
        where: { id: args.prId },
      });
      if (!pr) fail("Pull request not found", "NOT_FOUND", 404);
      const review = await prisma.review.create({
        data: {
          id: newId("review"),
          pullRequestId: args.prId,
          authorId: "demo-actor",
          state: args.input.state,
          body: args.input.body ?? null,
        },
      });
      await prisma.pullRequest.update({
        where: { id: args.prId },
        data: { updatedAt: new Date() },
      });
      return review;
    },

    async createBranch(_p: unknown, args: any, ctx: ForgeContext) {
      requireAuth(ctx);
      const repo = await prisma.repository.findUnique({
        where: { id: args.repoId },
      });
      if (!repo) fail("Repository not found", "NOT_FOUND", 404);
      const existing = await prisma.branch.findFirst({
        where: { repositoryId: args.repoId, name: args.name },
      });
      if (existing) fail("Branch already exists");
      return prisma.branch.create({
        data: {
          id: newId("branch"),
          repositoryId: args.repoId,
          name: args.name,
          sha: args.fromSha ?? newSha(),
          protected: false,
        },
      });
    },
  },

  // --- relation field resolvers ------------------------------------------

  Repository: {
    issues: (r: any) =>
      prisma.issue.findMany({
        where: { repositoryId: r.id },
        orderBy: { createdAt: "desc" },
      }),
    pullRequests: (r: any) =>
      prisma.pullRequest.findMany({
        where: { repositoryId: r.id },
        orderBy: { createdAt: "desc" },
      }),
    labels: (r: any) =>
      prisma.label.findMany({ where: { repositoryId: r.id } }),
    branches: (r: any) =>
      prisma.branch.findMany({ where: { repositoryId: r.id } }),
    commits: (r: any) =>
      prisma.commit.findMany({
        where: { repositoryId: r.id },
        orderBy: { committedAt: "desc" },
      }),
  },

  Issue: {
    author: (i: any) => prisma.user.findUnique({ where: { id: i.authorId } }),
    assignees: (i: any) =>
      prisma.user.findMany({ where: { id: { in: i.assigneeIds } } }),
    labels: (i: any) =>
      prisma.label.findMany({ where: { id: { in: i.labelIds } } }),
    comments: (i: any) =>
      prisma.comment.findMany({
        where: { subjectId: i.id },
        orderBy: { createdAt: "asc" },
      }),
    repository: (i: any) =>
      prisma.repository.findUnique({ where: { id: i.repositoryId } }),
  },

  PullRequest: {
    author: (p: any) => prisma.user.findUnique({ where: { id: p.authorId } }),
    reviews: (p: any) =>
      prisma.review.findMany({
        where: { pullRequestId: p.id },
        orderBy: { createdAt: "asc" },
      }),
    reviewers: (p: any) =>
      prisma.user.findMany({ where: { id: { in: p.reviewerIds } } }),
    comments: (p: any) =>
      prisma.comment.findMany({
        where: { subjectId: p.id },
        orderBy: { createdAt: "asc" },
      }),
    labels: (p: any) =>
      prisma.label.findMany({ where: { id: { in: p.labelIds } } }),
    repository: (p: any) =>
      prisma.repository.findUnique({ where: { id: p.repositoryId } }),
    mergeable: async (p: any) => {
      if (p.state !== "OPEN") return false;
      return !(await hasUnresolvedChanges(p.id));
    },
  },

  Review: {
    author: (r: any) => prisma.user.findUnique({ where: { id: r.authorId } }),
    pullRequest: (r: any) =>
      prisma.pullRequest.findUnique({ where: { id: r.pullRequestId } }),
  },

  Comment: {
    author: (c: any) => prisma.user.findUnique({ where: { id: c.authorId } }),
  },

  SearchResult: {
    __resolveType(obj: any) {
      if ("defaultBranch" in obj) return "Repository";
      if ("headRef" in obj) return "PullRequest";
      return "Issue";
    },
  },
};
