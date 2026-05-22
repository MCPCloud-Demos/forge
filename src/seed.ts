/**
 * Deterministic demo data for the Forge showcase tenant.
 *
 * `bun run src/seed.ts` wipes and re-seeds the demo tenant — this is what the
 * nightly Fly reset job runs. The app also seeds on startup when the database
 * is empty (SEED_ON_STARTUP). The seed is deterministic: a fixed PRNG drives
 * every choice so demos look identical run to run.
 *
 * It deliberately produces work for the "PR Review Readiness Sweep" companion
 * skill: open PRs with no reviewer, stale PRs, a PR with failing checks, and a
 * PR carrying a CHANGES_REQUESTED review.
 */

import { prisma } from "./db";
import { newId, newSha } from "./ids";

const TENANT = "demo";

/** mulberry32 — a tiny deterministic PRNG. */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = Date.now();
const day = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW - days * day);

const USERS = [
  { login: "ava-carter", name: "Ava Carter" },
  { login: "liam-nguyen", name: "Liam Nguyen" },
  { login: "noah-patel", name: "Noah Patel" },
  { login: "mia-okafor", name: "Mia Okafor" },
  { login: "ethan-reyes", name: "Ethan Reyes" },
  { login: "zoe-haddad", name: "Zoe Haddad" },
  { login: "lucas-larsen", name: "Lucas Larsen" },
  { login: "aria-cohen", name: "Aria Cohen" },
  { login: "mason-mwangi", name: "Mason Mwangi" },
  { login: "ivy-silva", name: "Ivy Silva" },
  { login: "leo-novak", name: "Leo Novak" },
  { login: "nora-khan", name: "Nora Khan" },
];

const REPOS = [
  {
    owner: "acme",
    name: "web-app",
    description: "Customer-facing web application.",
    isPrivate: false,
    stars: 184,
    issues: 9,
    prs: 5,
  },
  {
    owner: "acme",
    name: "api-gateway",
    description: "Edge API gateway and request router.",
    isPrivate: true,
    stars: 67,
    issues: 8,
    prs: 4,
  },
  {
    owner: "acme",
    name: "mobile-client",
    description: "iOS and Android client.",
    isPrivate: false,
    stars: 121,
    issues: 7,
    prs: 3,
  },
  {
    owner: "acme",
    name: "design-system",
    description: "Shared component library and design tokens.",
    isPrivate: false,
    stars: 93,
    issues: 6,
    prs: 3,
  },
];

const LABELS = [
  { name: "bug", color: "d73a4a", description: "Something is broken" },
  { name: "enhancement", color: "a2eeef", description: "New feature or request" },
  { name: "documentation", color: "0075ca", description: "Docs work" },
  { name: "needs-review", color: "fbca04", description: null },
  { name: "blocked", color: "b60205", description: null },
  { name: "good-first-issue", color: "7057ff", description: null },
];

const ISSUE_TITLES = [
  "Login form rejects valid email addresses",
  "Dark mode toggle resets on navigation",
  "Pagination skips the last result row",
  "Memory leak in the websocket reconnect loop",
  "Add rate-limit headers to API responses",
  "Search returns stale results after an edit",
  "Timezone handling is wrong for daylight saving",
  "Upload progress bar never reaches 100%",
  "Crash on empty notification payload",
  "Support keyboard navigation in the date picker",
  "Flaky integration test on the checkout flow",
  "Document the deployment rollback procedure",
  "Slow query on the dashboard activity feed",
  "Avatar images load without alt text",
  "Export CSV drops rows with unicode characters",
  "Webhook retries do not honour the backoff",
];

const PR_TITLES = [
  "Fix email validation regex",
  "Add structured request logging",
  "Refactor the auth middleware",
  "Cache repository lookups",
  "Introduce a feature-flag service",
  "Migrate the build to esbuild",
  "Add retry with exponential backoff",
  "Tidy up the settings page layout",
  "Bump dependencies to latest minor",
  "Add a healthcheck endpoint",
  "Split the monolith config module",
  "Improve error messages on 500s",
];

async function wipe(): Promise<void> {
  // Order does not strictly matter — no FK constraints — but clear leaves first.
  await prisma.review.deleteMany({});
  await prisma.comment.deleteMany({});
  await prisma.commit.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.pullRequest.deleteMany({});
  await prisma.issue.deleteMany({});
  await prisma.label.deleteMany({});
  await prisma.repository.deleteMany({});
  await prisma.user.deleteMany({});
}

async function build(): Promise<void> {
  const rng = makeRng(42);
  const pick = <T>(items: T[]): T => items[Math.floor(rng() * items.length)];

  // Users -----------------------------------------------------------------
  const userIds: string[] = [];
  for (const u of USERS) {
    const id = newId("user");
    userIds.push(id);
    await prisma.user.create({
      data: {
        id,
        tenantId: TENANT,
        login: u.login,
        name: u.name,
        avatarUrl: `https://avatars.forge.example/${u.login}.png`,
        createdAt: ago(200 + Math.floor(rng() * 120)),
      },
    });
  }
  // A stable actor every demo write (createIssue, addComment, …) is attributed
  // to, so the freshly created records always resolve a non-null author.
  await prisma.user.create({
    data: {
      id: "demo-actor",
      tenantId: TENANT,
      login: "forge-demo",
      name: "Forge Demo",
      avatarUrl: "https://avatars.forge.example/forge-demo.png",
      createdAt: ago(320),
    },
  });

  let prGlobal = 0;

  for (const repoSpec of REPOS) {
    const repoId = newId("repo");
    await prisma.repository.create({
      data: {
        id: repoId,
        tenantId: TENANT,
        owner: repoSpec.owner,
        name: repoSpec.name,
        description: repoSpec.description,
        isPrivate: repoSpec.isPrivate,
        defaultBranch: "main",
        stars: repoSpec.stars,
        createdAt: ago(260 + Math.floor(rng() * 90)),
      },
    });

    // Labels --------------------------------------------------------------
    const labelIds: Record<string, string> = {};
    for (const l of LABELS) {
      const id = newId("label");
      labelIds[l.name] = id;
      await prisma.label.create({
        data: {
          id,
          repositoryId: repoId,
          name: l.name,
          color: l.color,
          description: l.description,
        },
      });
    }

    // Branches ------------------------------------------------------------
    await prisma.branch.create({
      data: {
        id: newId("branch"),
        repositoryId: repoId,
        name: "main",
        sha: newSha(),
        protected: true,
      },
    });
    for (const name of ["develop", "release/next"]) {
      await prisma.branch.create({
        data: {
          id: newId("branch"),
          repositoryId: repoId,
          name,
          sha: newSha(),
          protected: false,
        },
      });
    }

    // Commits -------------------------------------------------------------
    for (let c = 0; c < 4; c++) {
      await prisma.commit.create({
        data: {
          id: newId("commit"),
          repositoryId: repoId,
          sha: newSha(),
          message: pick(PR_TITLES),
          authorId: pick(userIds),
          committedAt: ago(2 + Math.floor(rng() * 60)),
        },
      });
    }

    let number = 0;

    // Issues --------------------------------------------------------------
    for (let i = 0; i < repoSpec.issues; i++) {
      number += 1;
      const closed = rng() < 0.4;
      const created = ago(5 + Math.floor(rng() * 90));
      const updated = closed
        ? new Date(created.getTime() + Math.floor(rng() * 20) * day)
        : ago(Math.floor(rng() * 14));
      const issueLabels = [pick(LABELS).name];
      if (rng() < 0.4) issueLabels.push(pick(LABELS).name);
      const issueId = newId("issue");
      await prisma.issue.create({
        data: {
          id: issueId,
          repositoryId: repoId,
          number,
          title: pick(ISSUE_TITLES),
          body: "Reported by the demo seed. See the title for context.",
          state: closed ? "CLOSED" : "OPEN",
          authorId: pick(userIds),
          assigneeIds: rng() < 0.5 ? [pick(userIds)] : [],
          labelIds: [...new Set(issueLabels)].map((n) => labelIds[n]),
          createdAt: created,
          updatedAt: updated,
          closedAt: closed ? updated : null,
        },
      });
      // A couple of comments on roughly half the issues.
      if (rng() < 0.5) {
        await prisma.comment.create({
          data: {
            id: newId("comment"),
            subjectId: issueId,
            subjectType: "ISSUE",
            authorId: pick(userIds),
            body: "Thanks for the report — taking a look.",
            createdAt: new Date(created.getTime() + day),
          },
        });
      }
    }

    // Pull requests -------------------------------------------------------
    for (let p = 0; p < repoSpec.prs; p++) {
      number += 1;
      const created = ago(3 + Math.floor(rng() * 30));

      // A few PRs are given fixed shapes so the review-sweep skill always has
      // recognisable work: a draft, a failing-checks PR, a changes-requested
      // PR, no-reviewer PRs, and stale PRs.
      let state = "OPEN";
      let checksPassing = true;
      let reviewerIds: string[] = [];
      let staleDays = Math.floor(rng() * 2); // recent by default
      let merged = false;
      let mergedAt: Date | null = null;

      if (prGlobal === 0) {
        state = "DRAFT";
      } else if (prGlobal === 1) {
        checksPassing = false;
        reviewerIds = [pick(userIds)];
      } else if (prGlobal === 2) {
        reviewerIds = [pick(userIds)];
      } else if (prGlobal >= 3 && prGlobal <= 6) {
        reviewerIds = []; // no reviewer assigned
        staleDays = 3 + Math.floor(rng() * 4);
      } else if (prGlobal === 7 || prGlobal === 8) {
        reviewerIds = [pick(userIds)];
        staleDays = 4 + Math.floor(rng() * 5); // stale
      } else if (prGlobal === 9 || prGlobal === 10) {
        state = "MERGED";
        merged = true;
        mergedAt = new Date(created.getTime() + 3 * day);
        reviewerIds = [pick(userIds)];
      } else if (prGlobal === 11) {
        state = "CLOSED";
      } else {
        reviewerIds = rng() < 0.5 ? [pick(userIds)] : [];
        staleDays = Math.floor(rng() * 5);
      }

      const updated =
        state === "MERGED" && mergedAt ? mergedAt : ago(staleDays);
      const prId = newId("pr");
      await prisma.pullRequest.create({
        data: {
          id: prId,
          repositoryId: repoId,
          number,
          title: pick(PR_TITLES),
          body: "Opened by the demo seed.",
          state,
          authorId: pick(userIds),
          headRef: `feature/seed-${prGlobal}`,
          baseRef: "main",
          merged,
          mergeCommitSha: merged ? newSha() : null,
          checksPassing,
          reviewerIds,
          labelIds: rng() < 0.3 ? [labelIds["enhancement"]] : [],
          createdAt: created,
          updatedAt: updated,
          mergedAt,
        },
      });

      // Reviews: PR #2 carries a CHANGES_REQUESTED review (the eval case);
      // PR #8 carries an APPROVED review (the clean merge path).
      if (prGlobal === 2) {
        await prisma.review.create({
          data: {
            id: newId("review"),
            pullRequestId: prId,
            authorId: reviewerIds[0] ?? pick(userIds),
            state: "CHANGES_REQUESTED",
            body: "Please address the failing edge case before merging.",
            createdAt: new Date(created.getTime() + day),
          },
        });
      } else if (prGlobal === 8) {
        await prisma.review.create({
          data: {
            id: newId("review"),
            pullRequestId: prId,
            authorId: reviewerIds[0] ?? pick(userIds),
            state: "APPROVED",
            body: "Looks good — nice cleanup.",
            createdAt: new Date(created.getTime() + day),
          },
        });
      } else if (rng() < 0.35) {
        await prisma.review.create({
          data: {
            id: newId("review"),
            pullRequestId: prId,
            authorId: pick(userIds),
            state: "COMMENTED",
            body: "One small thought, otherwise fine.",
            createdAt: new Date(created.getTime() + day),
          },
        });
      }

      prGlobal += 1;
    }
  }
}

/** Seed only when the database has no repositories yet. */
export async function seedIfEmpty(): Promise<void> {
  const existing = await prisma.repository.count();
  if (existing > 0) return;
  await build();
}

/** Wipe every demo row and rebuild — used by the nightly reset job. */
export async function reseed(): Promise<void> {
  await wipe();
  await build();
}

if (import.meta.main) {
  reseed()
    .then(() => {
      console.log("Forge demo tenant re-seeded.");
      return prisma.$disconnect();
    })
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
