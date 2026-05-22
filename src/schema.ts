/**
 * Forge GraphQL schema.
 *
 * Deliberately terse — the SDL is the auto-generated "before" state MCPCloud's
 * enrichment is meant to fix. Most operations carry no description; a handful
 * carry a one-word or one-line description (`A repository.`, `Merge.`). Do not
 * add richer docs here: that terseness is the setup for the enrichment payoff.
 */

export const typeDefs = /* GraphQL */ `
  scalar DateTime

  enum IssueState {
    OPEN
    CLOSED
  }

  enum PullRequestState {
    OPEN
    CLOSED
    MERGED
    DRAFT
  }

  enum ReviewState {
    APPROVED
    CHANGES_REQUESTED
    COMMENTED
    PENDING
  }

  enum MergeMethod {
    MERGE
    SQUASH
    REBASE
  }

  enum SearchType {
    ISSUE
    PULL_REQUEST
    REPO
    CODE
  }

  enum IssueSort {
    CREATED
    UPDATED
    COMMENTS
  }

  type User {
    id: ID!
    login: String!
    name: String
    avatarUrl: String
    createdAt: DateTime!
  }

  type Label {
    id: ID!
    name: String!
    color: String!
    description: String
  }

  type Repository {
    id: ID!
    owner: String!
    name: String!
    description: String
    isPrivate: Boolean!
    defaultBranch: String!
    stars: Int!
    createdAt: DateTime!
    issues: [Issue!]!
    pullRequests: [PullRequest!]!
    labels: [Label!]!
    branches: [Branch!]!
    commits: [Commit!]!
  }

  type Issue {
    id: ID!
    number: Int!
    title: String!
    body: String
    state: IssueState!
    author: User!
    assignees: [User!]!
    labels: [Label!]!
    comments: [Comment!]!
    repository: Repository!
    createdAt: DateTime!
    updatedAt: DateTime!
    closedAt: DateTime
  }

  type PullRequest {
    id: ID!
    number: Int!
    title: String!
    body: String
    state: PullRequestState!
    author: User!
    headRef: String!
    baseRef: String!
    merged: Boolean!
    mergeable: Boolean!
    mergeCommitSha: String
    checksPassing: Boolean!
    reviews: [Review!]!
    reviewers: [User!]!
    comments: [Comment!]!
    labels: [Label!]!
    repository: Repository!
    createdAt: DateTime!
    updatedAt: DateTime!
    mergedAt: DateTime
  }

  type Review {
    id: ID!
    author: User!
    state: ReviewState!
    body: String
    pullRequest: PullRequest!
    createdAt: DateTime!
  }

  type Comment {
    id: ID!
    author: User!
    body: String!
    createdAt: DateTime!
  }

  type Branch {
    id: ID!
    name: String!
    sha: String!
    protected: Boolean!
  }

  type Commit {
    id: ID!
    sha: String!
    message: String!
    author: User!
    committedAt: DateTime!
  }

  union SearchResult = Repository | Issue | PullRequest

  input RepositoryFilter {
    owner: String
    isPrivate: Boolean
    query: String
  }

  input IssueFilter {
    state: IssueState
    labels: [String!]
    assignee: String
    author: String
  }

  input PullRequestFilter {
    state: PullRequestState
    author: String
    reviewer: String
  }

  input CreateIssueInput {
    repositoryId: ID!
    title: String!
    body: String
    labelIds: [ID!]
    assigneeIds: [ID!]
  }

  input UpdateIssueInput {
    title: String
    body: String
    state: IssueState
  }

  input CreatePullRequestInput {
    repositoryId: ID!
    title: String!
    body: String
    headRef: String!
    baseRef: String!
  }

  input SubmitReviewInput {
    state: ReviewState!
    body: String
  }

  type Query {
    repositories(filter: RepositoryFilter): [Repository!]!

    "A repository."
    repository(owner: String!, name: String!): Repository

    issues(repo: ID!, filter: IssueFilter, sort: IssueSort): [Issue!]!

    "An issue."
    issue(id: ID!): Issue

    pullRequests(repo: ID!, filter: PullRequestFilter): [PullRequest!]!

    "A PR."
    pullRequest(id: ID!): PullRequest

    "Labels."
    labels(repo: ID!): [Label!]!

    "Search."
    search(query: String!, type: SearchType): [SearchResult!]!

    user(login: String!): User
  }

  type Mutation {
    createIssue(input: CreateIssueInput!): Issue!

    updateIssue(id: ID!, input: UpdateIssueInput!): Issue!

    "Close."
    closeIssue(id: ID!): Issue!

    addComment(subjectId: ID!, body: String!): Comment!

    addLabels(subjectId: ID!, labelIds: [ID!]!): [Label!]!

    createPullRequest(input: CreatePullRequestInput!): PullRequest!

    "Merge."
    mergePullRequest(id: ID!, method: MergeMethod): PullRequest!

    requestReview(prId: ID!, userId: ID!): PullRequest!

    "Review."
    submitReview(prId: ID!, input: SubmitReviewInput!): Review!

    createBranch(repoId: ID!, name: String!, fromSha: String): Branch!
  }
`;
