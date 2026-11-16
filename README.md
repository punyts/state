# state
A state management system

## Links

`store.link(fromPath, toPath)` makes `fromPath` an alias of `toPath`, so a field and the data it edits are one value.
`store.unlink(fromPath)` removes the alias.

```ts
const store = createStore({ data: { orders: { k42: { total: 10 } } }, view: {} });

store.link('$.view.order', '$.data.orders.k42'); // true
store.get('$.view.order.total');                 // 10
store.set('$.view.order.total', 11);             // writes $.data.orders.k42.total
store.unlink('$.view.order');                    // true
```

There is one kind of link, the alias. Every path at or below the alias path is the same path below the target.

- Reads (`get`, proxy property access, `keys`) and writes (`set`, `apply`, `applyIf`, `replace`, `delete`, proxy
  assignment) at or below the alias act on the target. A target that is itself an alias is followed.
- A change at the target notifies the listeners registered on the alias path and below it, with the alias path in the
  event. A change inside the target notifies the matching path below the alias, for example a listener on
  `$.view.order.total` hears a write to `$.data.orders.k42.total`. A change above the target (a `replace` of
  `$.data.orders`) notifies the alias path and below it. A listener on the target is called once. Adding or removing a
  sibling of the target does not notify the alias.
- Replacing the value the target holds keeps the link.
- Links are runtime structure, not state data. An alias path holds nothing in the state, so `store.get('$')` contains
  the target data once, at the target path, and nothing under the alias.
- `unlink` stops both directions. Listeners registered on the alias path stay registered; remove them with `off`.
- `store.resolve(path)` gives the path with every link followed (`$.view.order.total` → `$.data.orders.k42.total`), and
  the path itself when no alias is in it.

`link` returns `false` when it does nothing:

- the target does not exist (the caller reports it as missing), unless `allowMissing` is set,
- the target is the alias itself, inside it or above it, or the chain of links loops (the caller reports a cycle),
- `fromPath` already holds data in the state,
- a path is not valid, or `fromPath` is the root.

### Re-pointing

`link` on a path that already is an alias moves the alias to the new target. Record views recycle slots this way.

```ts
store.link('$.view.order', '$.data.orders.k43'); // true, $.view.order was an alias of $.data.orders.k42
```

- Every listener registered at or below the alias path is called once, in one pass, with the `relink` action, the alias
  path, the value the alias shows now and the value it showed before. No listener is added or removed.
- A link whose target is another alias follows it. Every alias that resolves through the re-pointed one is notified too
  (a detail field linked to a list's `current`, or an alias linked to `$.slot.row.x` when `$.slot.row` is re-pointed).
  A listener is called once per re-point, even when it is registered on several of those aliases, and also when it sits
  below an alias that leads to a path below, or above, another alias that the re-point changes (any depth of aliases).
- The work does not depend on the size of the store: a re-point reads the old and the new target and each notified alias,
  nothing else.
- A re-point that is refused (`false`) leaves the alias as it was.

### allowMissing

`store.link(fromPath, toPath, { allowMissing: true })` accepts a target that does not exist yet, as long as the parent of
the target exists and is an object or array. Without the option a missing target is refused.

```ts
store.link('$.view.x', '$.data.orders.k42.x', { allowMissing: true }); // true
store.get('$.view.x');                                                 // undefined
store.set('$.data.orders.k42.x', 1);                                   // the listeners of $.view.x are called
```

Reads give `undefined` while the target is missing. The listeners on the alias are called when the target appears,
changes or goes, including when a path above it is replaced. A write through the alias creates the target.

## Protecting paths

`store.protect(path)` makes a path read-only and `store.unprotect(path)` lifts it. `protect` returns `false` for an
invalid path, `unprotect` returns `false` when the path was not protected.

```ts
store.protect('$.runtime.empty');
store.set('$.runtime.empty.x', 1);  // false, nothing is emitted
store.link('$.view.form', '$.runtime.empty');
store.set('$.view.form.x', 1);      // false, the alias leads to a protected path
```

- A write at or below a protected path returns `false` and emits nothing. This covers `set`, `apply`, `applyIf`,
  `replace`, `delete` and assignment or `delete` through a proxy (the proxy ignores them, as it ignores any refused write).
- A write through an alias to a protected path is refused the same way, however long the chain of aliases.
- Reads, links to the path and listeners work as usual.
- A write to a path above a protected path is not refused, so protect the paths that must not change and do not replace
  their parents.

## Write origin

A write can carry a tag, its origin, which its listeners receive as a fifth argument. State sync uses it to tell a
server's changes, which must not be sent back, from the user's own.

```ts
store.on('$.data.$all', (path, value, oldValue, action, origin) => {
    if (origin !== 'sync') send(path, value);           // only the local changes leave
});
store.set('$.data.total', 12, { origin: 'sync' });      // the listener hears origin 'sync'
store.set('$.data.total', 13);                          // the listener hears no origin
```

- `set`, `delete`, `apply`, `applyIf` and `replace` take `{ origin }` as their last argument; `link` takes `origin` in
  its options, for the `relink` events of a re-point.
- Every event of the write carries the origin: the per-key events of a merge, the `insert-child`, `update-child` and
  `delete-child` events of the parent, and the events passed on to aliases.
- A write a listener makes while it is called is its own: it carries no origin unless it passes one.
- An untagged write calls listeners with four arguments, as before. Assignment through a proxy is untagged.

Links: not carried over from statenet are its hard links and soft links. Only the alias exists.
