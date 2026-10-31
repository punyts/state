# Changelog

## Unreleased
- **Re-pointing reaches listeners behind several aliases.** Re-pointing an alias now notifies every listener whose resolved path changed, once, at any depth and arrangement of aliases, including a listener below an alias that leads to another alias below the re-pointed one (for example a view alias over a holder whose child is linked through the re-pointed alias). A change at the new target reaches those listeners too.

## 1.2.0
- **Store links.** `store.link(from, to)` makes a path an alias of another; reads and writes at or below the alias act on the target, changes at, above or inside the target notify the alias listeners, and aliases never appear in `store.get('$')` snapshots. `store.unlink(from)` removes it (AMM-1639).
- **Re-pointing, chains, `allowMissing` and `protect`.** `link` on an existing alias re-points it and notifies every listener at or below it, and on every alias that resolves through it, once. `link(from, to, { allowMissing: true })` accepts a target that does not exist yet. `store.protect(path)` / `store.unprotect(path)` make a path read-only, also through aliases (AMM-1642).

## 1.1.0
- Array mutators through proxies produce the same array as on a plain array and emit on the array path (AMM-1584).
