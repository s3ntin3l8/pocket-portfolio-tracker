---
name: Issue Blueprint
about: File an issue following the standard Pocket context and scope blueprint.
title: "type: short description"
labels: ""
assignees: ""
---

## Context

<!-- Describe the problem, current behavior, and code references or snippets showing the
affected areas. -->

<!-- If this touches derived numbers (holdings, P&L, XIRR/TWR, tax, contributions), name
the affected packages/core module and the portfolio's cashCounted boundary
(cash-inside vs. cash-outside) — most ambiguity in this repo lives at that boundary. -->

```ts
// Code snippet showing the issue
```

## Scope

- [ ] <!-- Requirement 1 -->
- [ ] <!-- Requirement 2 -->
- [ ] Update `docs/*.md` (tax, trade_republic, dkb, interactive_brokers, data_providers) if broker/tax/provider behavior changes
- [ ] Update `CLAUDE.md` if a convention or invariant changes
- [ ] Test coverage additions/modifications (gate is 70%)
