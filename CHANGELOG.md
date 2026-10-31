# Changelog

## 1.2.0
- **Store links.** `store.link(from, to)` makes a path an alias of another; reads and writes at or below the alias act on the target, changes at, above or inside the target notify the alias listeners, and aliases never appear in `store.get('$')` snapshots. `store.unlink(from)` removes it (AMM-1639).
- **Re-pointing, chains, `allowMissing` and `protect`.** `link` on an existing alias re-points it and notifies every listener at or below it, and on every alias that resolves through it, once. `link(from, to, { allowMissing: true })` accepts a target that does not exist yet. `store.protect(path)` / `store.unprotect(path)` make a path read-only, also through aliases (AMM-1642).

## 1.1.0
- Array mutators through proxies produce the same array as on a plain array and emit on the array path (AMM-1584).
