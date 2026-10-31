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

`link` returns `false` when it does nothing:

- the target does not exist (the caller reports it as missing),
- the target is the alias itself, inside it or above it, or the chain of links loops (the caller reports a cycle),
- `fromPath` already is an alias, or already holds data in the state,
- a path is not valid, or `fromPath` is the root.

Not carried over from statenet: its hard links and soft links. Only the alias above exists.
