# Phase 2 Remaining Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** Eliminate ~200 lines of route-level boilerplate via `request.userId` auto-injection, `requirePortfolio` decorator, and auto `logTiming` via `onResponse`.

**Architecture:** All three are Fastify hook/decorator patterns added in `plugins/auth.ts` (already has `authenticate`/`requireAdmin`). Mix of one-time plugin changes + mechanical per-route edits.

**Tech Stack:** Fastify 5, TypeScript 5, services/api workspace

---

### Task 1: Auto-inject `request.userId`

**Files:**

- Modify: `services/api/src/plugins/auth.ts`
- Modify: 24 route files (mechanical replacement)

- [ ] **Step 1: Add `userId` to FastifyRequest and set it in `authenticate`**

In `auth.ts`, add `userId: string` to the `interface FastifyRequest` declaration block (line 207-209):

```typescript
interface FastifyRequest {
  user?: AuthedUser;
  userId: string;
}
```

Then set `request.userId = user.id` in both auth paths:

- After line 147 (`request.user = {...pat user...}`): add `request.userId = u.id;`
- After line 187 (`request.user = {...jwt user...}`): add `request.userId = user.id;`

Also set `request.userId = user.id` in the JWT path (after existing `request.user` assignment on line 187).

- [ ] **Step 2: Replace `requireUser` → `request.userId` in route files**

For every file in the list below, find `const { id } = requireUser(request)` and replace with `const userId = request.userId;`. Keep `requireUser` where `isAdmin`, `scope`, or `authSub` is destructured (admin routes, me routes).

Files to modify:

- `routes/imports.ts` (12x) — `const { id }` → `const userId = request.userId`
- `routes/transactions/crud.ts` (11x)
- `routes/tr.ts` (9x)
- `routes/documents.ts` (7x)
- `routes/account-holders.ts` (6x)
- `routes/ibkr.ts` (5x)
- `routes/me.ts` (5x — but keep `requireUser` for admin/scope checks)
- `routes/portfolios.ts` (5x)
- `routes/targets.ts` (4x)
- `routes/imports/parse.ts` (4x)
- `routes/transactions/holdings.ts` (3x)
- `routes/transactions/history.ts` (3x)
- `routes/transactions/income.ts` (3x)
- `routes/transactions/trades.ts` (2x)
- `routes/transactions/tax.ts` (2x)
- `routes/transactions/list.ts` (2x)
- `routes/transactions/sparplan.ts` (2x)
- `routes/transactions/contributions.ts` (2x)
- `routes/preferences.ts` (2x)
- `routes/mergers.ts` (1x)
- `routes/search.ts` (1x)
- `routes/imports/confirm.ts` (1x)
- `routes/transactions/insights.ts` (1x)
- `routes/transactions/networth.ts` (1x)

For `me.ts`: keep `requireUser` in places that use `isAdmin`/`scope`, change other `const { id }` to `request.userId`.

Remove `import { requireUser } from ...` from files where it's no longer used.

- [ ] **Step 3: Run typecheck + affected tests**

```bash
npm run typecheck
npx vitest run services/api/test/routes/ --reporter=verbose 2>&1 | tail -30
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: auto-inject request.userId via authenticate decorator"
```

---

### Task 2: `requirePortfolio` decorator

**Files:**

- Modify: `services/api/src/plugins/auth.ts`
- Modify: `services/api/src/routes/helpers.ts` (if type changes needed)
- Modify: 12 route files (add preHandler, replace portfolio fetch)

- [ ] **Step 1: Add `requirePortfolio` decorator + `portfolio` to FastifyRequest**

In `auth.ts`, add imports and type:

```typescript
import { ownedPortfolio } from "./helpers.js";
// ... in the FastifyRequest interface block:
import type { PortfolioRow } from "./helpers.js"; // or define inline
interface FastifyRequest {
  user?: AuthedUser;
  userId: string;
  portfolio: PortfolioRow;
}
```

Wait — need to check what type `ownedPortfolio` returns. From `helpers.ts`, it returns `flattenJoinRow(row)` which is `portfolios.$inferSelect & { accountHolder: accountHolders.$inferSelect | null }`. Let me define a type for this.

Actually, `ownedPortfolio` returns the flattened type from `flattenJoinRow`. Let me just use `any` in the decorator and let callers cast... no, that's bad.

Better approach: add a `PortfolioWithHolder` type export from `helpers.ts`.

```typescript
export type PortfolioWithHolder = NonNullable<Awaited<ReturnType<typeof ownedPortfolio>>>;
```

Then in `auth.ts`:

```typescript
import { ownedPortfolio, type PortfolioWithHolder } from "../routes/helpers.js";
```

Wait, `auth.ts` is in `plugins/` and `helpers.ts` is in `routes/`. The relative path would be `../routes/helpers.js`.

Add the decorator:

```typescript
app.decorate(
  "requirePortfolio",
  async function (this: FastifyInstance, request: FastifyRequest, reply: FastifyReply) {
    const { portfolioId } = request.params as { portfolioId?: string };
    if (!portfolioId) return reply.code(400).send({ error: "portfolio_id_required" });
    const portfolio = await ownedPortfolio(this, request.userId, portfolioId);
    if (!portfolio) return reply.code(404).send({ error: "portfolio_not_found" });
    request.portfolio = portfolio;
  },
);
```

Add type declarations:

```typescript
interface FastifyInstance {
  authenticate: ...;
  requireAdmin: ...;
  requirePortfolio: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}
interface FastifyRequest {
  user?: AuthedUser;
  userId: string;
  portfolio: PortfolioWithHolder;
}
```

- [ ] **Step 2: Add preHandler to routes + replace portfolio fetches**

For each route that uses `ownedPortfolio` with a guard block, add `app.requirePortfolio` to the preHandler array:

```typescript
// Before:
app.get("/path", { preHandler: app.authenticate }, async (request, reply) => {
  const { id } = requireUser(request);
  const portfolio = await ownedPortfolio(app, id, portfolioId);
  if (!portfolio) return reply.code(404).send({ error: "portfolio_not_found" });
  // use portfolio...
```

```typescript
// After:
app.get("/path", { preHandler: [app.authenticate, app.requirePortfolio] }, async (request, reply) => {
  // request.portfolio is already populated
  // use request.portfolio...
```

For routes that use `ownedPortfolio` via the one-liner `if (!(await ownedPortfolio(...)))`:

- Not needed to change these if they don't need the portfolio data
- Can safely add for consistency though

Files to modify (add `requirePortfolio` to preHandler + replace `await ownedPortfolio(...)` with `request.portfolio`):

- `documents.ts`: 4x ownedPortfolio, 7x requireUser
- `transactions/list.ts`: 1x ownedPortfolio
- `transactions/crud.ts`: 11x ownedPortfolio
- `transactions/holdings.ts`: 3x ownedPortfolio
- `transactions/trades.ts`: 1x ownedPortfolio
- `transactions/income.ts`: 2x ownedPortfolio
- `transactions/tax.ts`: 1x ownedPortfolio
- `transactions/contributions.ts`: 1x ownedPortfolio
- `transactions/sparplan.ts`: 1x ownedPortfolio
- `transactions/history.ts`: 2x ownedPortfolio
- `imports.ts`: 4x ownedPortfolio
- `targets.ts`: 2x ownedPortfolio

For `crud.ts` with 11x `ownedPortfolio` — these are within individual operation handlers registered in a single route group. Adding `requirePortfolio` as a global preHandler means ALL handlers in that file get it, including ones that don't need it (though extra DB query is wasted). Better to check which actual routes need it.

- [ ] **Step 3: Run typecheck + tests**

- [ ] **Step 4: Commit**

---

### Task 3: Auto logTiming via onResponse

**Files:**

- Modify: `services/api/src/plugins/auth.ts` (or a new timing plugin)
- Modify: `services/api/src/app.ts` (register the hook)
- Modify: `services/api/src/lib/timing.ts` (add `timingMeta`)
- Modify: 16 route files (remove `performance.now()`/`durationMs`/`logTiming` calls)

- [ ] **Step 1: Add timingMeta to FastifyRequest + onResponse hook**

In `auth.ts` type block:

```typescript
interface FastifyRequest {
  user?: AuthedUser;
  userId: string;
  portfolio: PortfolioWithHolder;
  timingMeta?: Record<string, unknown>;
}
```

Register the `onResponse` hook. Best place: `app.ts` after all plugins are registered, or create a new plugin.

```typescript
app.addHook("onResponse", (request, reply) => {
  if (!process.env.TIMING_ENABLED) return;
  const durationMs = reply.elapsedTime; // or calculate from request
  request.log.info(
    { durationMs: Math.round(durationMs * 100) / 100, ...request.timingMeta },
    `[timing] ${request.routeOptions.url ?? request.url}`,
  );
});
```

Wait, does Fastify 5 have `reply.elapsedTime`? Let me check. Actually Fastify 5 has `request.elapsedTime` which is the time since the request started. But at `onResponse` time, it gives us the total time (including response serialization). That's fine for our purposes.

But there's a subtlety: Fastify's `request.elapsedTime` might not exist in the current version. Let me check by looking at the package.json or lockfile for the Fastify version.

Actually, `request.elapsedTime` is available since Fastify 4.x as a read-only property. In Fastify 5 it should be available too. It measures time from the `onRequest` hook to the current moment.

At `onResponse` time, `request.elapsedTime` gives total request-response time. This is close enough to handler execution time for our timing purposes (the extra ~1ms for serialization is noise).

- [ ] **Step 2: Replace all `performance.now()`/`logTiming` in route files**

For each route handler that has:

```typescript
const t0 = performance.now();
// ... work ...
const durationMs = performance.now() - t0;
logTiming(request, "NAME", durationMs, { extra });
```

Replace with:

```typescript
request.timingMeta = { extra };
// ... work ...
```

For handlers without extra context (just timing), remove the timing lines entirely.

Remove unused `import { logTiming } from ...` from files where it's no longer referenced.

- [ ] **Step 3: Run typecheck + full test suite**

- [ ] **Step 4: Commit**

---

### Task 4: Final verification and PR

- [ ] **Step 1: Run full lint + typecheck + test suite**

```bash
npm run lint && npm run typecheck && npm test 2>&1 | tail -10
```

- [ ] **Step 2: Create PR**

```bash
git push -u origin HEAD
gh pr create --title "Phase 2: requirePortfolio, auto userId, auto logTiming" --body "Closes remaining Phase 2 items in #550"
```

- [ ] **Step 3: Update issue #550**
- Check `requirePortfolio`, `request.userId`, and `logTiming` checkboxes in the issue body
