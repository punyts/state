import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from './Store.js';

describe('Store links', () => {
    let store: ReturnType<typeof createStore<any>>;

    beforeEach(() => {
        store = createStore<any>({
            data: {
                name: 'Ada',
                orders: {
                    k42: { total: 10, address: { city: 'Oslo' } },
                    k43: { total: 20 }
                },
                list: [{ v: 1 }, { v: 2 }, { v: 3 }]
            },
            view: {}
        });
    });

    describe('link', () => {
        it('should return true and make the alias read the target', () => {
            const result = store.link('$.view.field', '$.data.name');

            expect(result).toBe(true);
            expect(store.get('$.view.field')).toBe('Ada');
        });

        it('should read an object target through the alias as a proxy', () => {
            store.link('$.view.order', '$.data.orders.k42');

            const order = store.get('$.view.order');

            expect(order.total).toBe(10);
            expect(order.address.city).toBe('Oslo');
            expect(store.get('$.view.order.address.city')).toBe('Oslo');
        });

        it('should read through the alias by proxy property access', () => {
            store.link('$.view.order', '$.data.orders.k42');

            expect(store.state.view.order.total).toBe(10);
            expect('order' in store.state.view).toBe(true);
        });

        it('should list the keys of the target under the alias', () => {
            store.link('$.view.order', '$.data.orders.k42');

            expect(store.keys('$.view.order')).toEqual(['total', 'address']);
        });

        it('should return false for a missing target', () => {
            const result = store.link('$.view.field', '$.data.nothing');

            expect(result).toBe(false);
            expect(store.get('$.view.field')).toBeUndefined();
        });

        it('should return false for a target inside the alias itself', () => {
            store.link('$.view.order', '$.data.orders.k42');

            expect(store.link('$.data.orders', '$.data.orders.k42')).toBe(false);
            expect(store.link('$.view.order.deep', '$.view.order.deep')).toBe(false);
        });

        it('should return false for a target above the alias', () => {
            expect(store.link('$.data.orders.k42.copy', '$.data.orders')).toBe(false);
        });

        it('should return false for a loop through a chain', () => {
            store.link('$.view.a', '$.data.orders.k42');
            store.link('$.data.orders.k43.p', '$.view.a.address');

            expect(store.link('$.data.orders.k42.address.q', '$.data.orders.k43.p')).toBe(false);
            expect(store.get('$.data.orders.k43.p.city')).toBe('Oslo');
        });

        it('should return false when the target resolves back to the alias', () => {
            store.link('$.view.a', '$.data.orders.k42');

            expect(store.link('$.data.orders.k42.back', '$.view.a')).toBe(false);
        });

        it('should return false for an invalid path and for the root', () => {
            expect(store.link('$', '$.data.name')).toBe(false);
            expect(store.link('$.view..x', '$.data.name')).toBe(false);
        });

        it('should return false when the alias holds data', () => {
            store.link('$.view.field', '$.data.name');

            expect(store.link('$.data.name', '$.data.orders')).toBe(false);
            expect(store.get('$.view.field')).toBe('Ada');
        });

        it('should link to an array element', () => {
            store.link('$.view.current', '$.data.list.1');

            expect(store.get('$.view.current.v')).toBe(2);
            store.set('$.view.current.v', 20);
            expect(store.get('$.data.list.1.v')).toBe(20);
        });

        it('should follow a chain of two links', () => {
            store.link('$.view.a', '$.data.orders.k42');
            store.link('$.view.b', '$.view.a');

            expect(store.get('$.view.b.total')).toBe(10);
            store.set('$.view.b.total', 11);
            expect(store.get('$.data.orders.k42.total')).toBe(11);
        });
    });

    describe('writes', () => {
        it('should write a primitive at the alias to the target', () => {
            store.link('$.view.field', '$.data.name');

            const result = store.set('$.view.field', 'Grace');

            expect(result).toBe(true);
            expect(store.get('$.data.name')).toBe('Grace');
            expect(store.get('$.view.field')).toBe('Grace');
        });

        it('should write below an alias to an object', () => {
            store.link('$.view.order', '$.data.orders.k42');

            store.set('$.view.order.address.city', 'Rome');

            expect(store.get('$.data.orders.k42.address.city')).toBe('Rome');
        });

        it('should write by proxy assignment through the alias', () => {
            store.link('$.view.order', '$.data.orders.k42');

            store.get('$.view.order').total = 99;

            expect(store.get('$.data.orders.k42.total')).toBe(99);
        });

        it('should write by assignment to an alias property on the state proxy', () => {
            store.link('$.view.field', '$.data.name');

            store.state.view.field = 'Linus';

            expect(store.get('$.data.name')).toBe('Linus');
        });

        it('should apply through the alias', () => {
            store.link('$.view.order', '$.data.orders.k42');

            store.apply('$.view.order', { total: 12, note: 'x' });

            expect(store.get('$.data.orders.k42')).toEqual({ total: 12, note: 'x', address: { city: 'Oslo' } });
        });

        it('should applyIf through the alias', () => {
            store.link('$.view.order', '$.data.orders.k42');

            store.applyIf('$.view.order', { total: 12, note: 'x' });

            expect(store.get('$.data.orders.k42.total')).toBe(10);
            expect(store.get('$.data.orders.k42.note')).toBe('x');
        });

        it('should replace through the alias', () => {
            store.link('$.view.order', '$.data.orders.k42');

            const result = store.replace('$.view.order', { total: 1 });

            expect(result).toBe(true);
            expect(store.get('$.data.orders.k42')).toEqual({ total: 1 });
        });

        it('should delete through the alias', () => {
            store.link('$.view.order', '$.data.orders.k42');

            const result = store.delete('$.view.order.total');

            expect(result).toBe(true);
            expect(store.get('$.data.orders.k42.total')).toBeUndefined();
        });

        it('should keep the link when the target value is replaced', () => {
            store.link('$.view.order', '$.data.orders.k42');
            const listener = vi.fn();
            store.on('$.view.order', listener);

            store.replace('$.data.orders.k42', { total: 5 });

            expect(store.get('$.view.order.total')).toBe(5);
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith('$.view.order', expect.anything(), expect.anything(), 'replace');
        });
    });

    describe('events', () => {
        it('should notify the alias listener of a change at the target', () => {
            store.link('$.view.field', '$.data.name');
            const listener = vi.fn();
            store.on('$.view.field', listener);

            store.set('$.data.name', 'Grace');

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith('$.view.field', 'Grace', 'Ada', 'update');
        });

        it('should fire a listener on the target once', () => {
            store.link('$.view.field', '$.data.name');
            const targetListener = vi.fn();
            store.on('$.data.name', targetListener);

            store.set('$.data.name', 'Grace');

            expect(targetListener).toHaveBeenCalledTimes(1);
            expect(targetListener).toHaveBeenCalledWith('$.data.name', 'Grace', 'Ada', 'update');
        });

        it('should notify both listeners when the write goes through the alias', () => {
            store.link('$.view.field', '$.data.name');
            const aliasListener = vi.fn();
            const targetListener = vi.fn();
            store.on('$.view.field', aliasListener);
            store.on('$.data.name', targetListener);

            store.set('$.view.field', 'Grace');

            expect(aliasListener).toHaveBeenCalledTimes(1);
            expect(targetListener).toHaveBeenCalledTimes(1);
            expect(targetListener.mock.calls[0][0]).toBe('$.data.name');
        });

        it('should notify listeners below the alias path with the alias path in the event', () => {
            store.link('$.view.order', '$.data.orders.k42');
            const below = vi.fn();
            store.on('$.view.order.total', below);

            store.replace('$.data.orders.k42', { total: 5 });

            expect(below).toHaveBeenCalledTimes(1);
            expect(below.mock.calls[0][0]).toBe('$.view.order');
        });

        it('should map a write inside the target to the path below the alias', () => {
            store.link('$.view.order', '$.data.orders.k42');
            const listener = vi.fn();
            store.on('$.view.order.total', listener);

            store.set('$.data.orders.k42.total', 77);

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith('$.view.order.total', 77, 10, 'update');
        });

        it('should map a write deep inside the target', () => {
            store.link('$.view.order', '$.data.orders.k42');
            const listener = vi.fn();
            store.on('$.view.order.address.city', listener);

            store.set('$.data.orders.k42.address.city', 'Rome');

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('should notify the alias listener of a write above the target', () => {
            store.link('$.view.order', '$.data.orders.k42');
            const listener = vi.fn();
            store.on('$.view.order', listener);

            store.replace('$.data.orders', { k42: { total: 1 } });

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0]).toBe('$.view.order');
        });

        it('should not notify the alias when a sibling of the target is added', () => {
            store.link('$.view.order', '$.data.orders.k42');
            const listener = vi.fn();
            store.on('$.view.order', listener);

            store.set('$.data.orders.k44', { total: 1 });

            expect(listener).not.toHaveBeenCalled();
        });

        it('should notify the alias of a delete of the target', () => {
            store.link('$.view.field', '$.data.name');
            const listener = vi.fn();
            store.on('$.view.field', listener);

            store.delete('$.data.name');

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith('$.view.field', undefined, 'Ada', 'delete');
        });

        it('should notify an alias listener through a chain of two links', () => {
            store.link('$.view.a', '$.data.name');
            store.link('$.view.b', '$.view.a');
            const listener = vi.fn();
            store.on('$.view.b', listener);

            store.set('$.data.name', 'Grace');

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0]).toBe('$.view.b');
        });

        it('should notify wildcard listeners below the alias', () => {
            store.link('$.view.order', '$.data.orders.k42');
            const listener = vi.fn();
            store.on('$.view.order.$every', listener);

            store.set('$.data.orders.k42.total', 3);

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0]).toBe('$.view.order.total');
        });
    });

    describe('unlink', () => {
        it('should return true and remove the alias', () => {
            store.link('$.view.field', '$.data.name');

            const result = store.unlink('$.view.field');

            expect(result).toBe(true);
            expect(store.get('$.view.field')).toBeUndefined();
        });

        it('should return false when the path is not an alias', () => {
            expect(store.unlink('$.view.field')).toBe(false);
        });

        it('should stop target changes reaching the alias listeners', () => {
            store.link('$.view.field', '$.data.name');
            const listener = vi.fn();
            store.on('$.view.field', listener);
            store.unlink('$.view.field');

            store.set('$.data.name', 'Grace');

            expect(listener).not.toHaveBeenCalled();
        });

        it('should stop writes at the alias path reaching the target', () => {
            store.link('$.view.field', '$.data.name');
            store.unlink('$.view.field');

            store.set('$.view.field', 'Grace');

            expect(store.get('$.data.name')).toBe('Ada');
            expect(store.get('$.view.field')).toBe('Grace');
        });

        it('should let off remove a listener after unlink', () => {
            store.link('$.view.field', '$.data.name');
            const listener = vi.fn();
            store.on('$.view.field', listener);
            store.unlink('$.view.field');

            store.off('$.view.field', listener);
            store.set('$.view.field', 'direct');

            expect(listener).not.toHaveBeenCalled();
        });

        it('should allow the alias to be linked again', () => {
            store.link('$.view.field', '$.data.name');
            store.unlink('$.view.field');

            expect(store.link('$.view.field', '$.data.orders.k42.total')).toBe(true);
            expect(store.get('$.view.field')).toBe(10);
        });
    });

    describe('snapshot', () => {
        it('should hold the target data once and nothing under the alias', () => {
            store.link('$.view.order', '$.data.orders.k42');
            store.link('$.view.field', '$.data.name');

            const snapshot = JSON.parse(JSON.stringify(store.get('$')));

            expect(snapshot.data.orders.k42).toEqual({ total: 10, address: { city: 'Oslo' } });
            expect(snapshot.view).toEqual({});
            expect(JSON.stringify(snapshot).split('Oslo').length - 1).toBe(1);
            expect(snapshot.data.name).toBe('Ada');
        });

        it('should stay free of alias paths after writes through the alias', () => {
            store.link('$.view.order', '$.data.orders.k42');

            store.set('$.view.order.total', 50);
            store.apply('$.view.order', { extra: true });

            const snapshot = JSON.parse(JSON.stringify(store.get('$')));
            expect(snapshot.view).toEqual({});
            expect(snapshot.data.orders.k42.total).toBe(50);
        });
    });

    describe('re-pointing', () => {
        it('should move an existing alias to a new target', () => {
            store.link('$.view.order', '$.data.orders.k42');

            const result = store.link('$.view.order', '$.data.orders.k43');

            expect(result).toBe(true);
            expect(store.get('$.view.order.total')).toBe(20);
            store.set('$.view.order.total', 21);
            expect(store.get('$.data.orders.k43.total')).toBe(21);
            expect(store.get('$.data.orders.k42.total')).toBe(10);
        });

        it('should return false and keep the old target when the new target is missing', () => {
            store.link('$.view.order', '$.data.orders.k42');

            expect(store.link('$.view.order', '$.data.orders.k99')).toBe(false);
            expect(store.get('$.view.order.total')).toBe(10);
        });

        it('should return false and keep the old target when the re-point would loop', () => {
            store.link('$.view.a', '$.data.orders.k42');
            store.link('$.view.b', '$.view.a');

            expect(store.link('$.view.a', '$.view.b')).toBe(false);
            expect(store.get('$.view.b.total')).toBe(10);
        });

        it('should notify each listener at or below the alias once with the relink action', () => {
            store.link('$.view.order', '$.data.orders.k42');
            const atAlias = vi.fn();
            const below = vi.fn();
            const wildcard = vi.fn();
            store.on('$.view.order', atAlias);
            store.on('$.view.order.total', below);
            store.on('$.view.order.$every', wildcard);

            store.link('$.view.order', '$.data.orders.k43');

            expect(atAlias).toHaveBeenCalledTimes(1);
            expect(below).toHaveBeenCalledTimes(1);
            expect(wildcard).toHaveBeenCalledTimes(1);
            expect(atAlias.mock.calls[0][0]).toBe('$.view.order');
            expect(atAlias.mock.calls[0][1].total).toBe(20);
            expect(atAlias.mock.calls[0][2].total).toBe(10);
            expect(atAlias.mock.calls[0][3]).toBe('relink');
        });

        it('should not notify listeners that are not at or below the alias', () => {
            store.link('$.view.order', '$.data.orders.k42');
            const other = vi.fn();
            const oldTarget = vi.fn();
            store.on('$.view.other', other);
            store.on('$.data.orders.k42', oldTarget);

            store.link('$.view.order', '$.data.orders.k43');

            expect(other).not.toHaveBeenCalled();
            expect(oldTarget).not.toHaveBeenCalled();
        });

        it('should keep listeners working after the re-point and stop hearing the old target', () => {
            store.link('$.view.order', '$.data.orders.k42');
            const listener = vi.fn();
            store.on('$.view.order.total', listener);
            store.link('$.view.order', '$.data.orders.k43');
            listener.mockClear();

            store.set('$.data.orders.k43.total', 25);
            store.set('$.data.orders.k42.total', 11);

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith('$.view.order.total', 25, 20, 'update');
        });

        it('should notify a listener on a second alias linked below the first', () => {
            store.link('$.view.row', '$.data.orders.k42');
            store.link('$.view.text', '$.view.row.total');
            const text = vi.fn();
            store.on('$.view.text', text);

            store.link('$.view.row', '$.data.orders.k43');

            expect(text).toHaveBeenCalledTimes(1);
            expect(text).toHaveBeenCalledWith('$.view.text', 20, 10, 'relink');
            expect(store.get('$.view.text')).toBe(20);
        });

        it('should notify the listeners of a chain of aliases once each when the first is re-pointed', () => {
            store.link('$.view.current', '$.data.list.0');
            store.link('$.view.detail', '$.view.current');
            store.link('$.view.field', '$.view.detail.v');
            const detail = vi.fn();
            const field = vi.fn();
            store.on('$.view.detail', detail);
            store.on('$.view.field', field);

            store.link('$.view.current', '$.data.list.2');

            expect(detail).toHaveBeenCalledTimes(1);
            expect(field).toHaveBeenCalledTimes(1);
            expect(field).toHaveBeenCalledWith('$.view.field', 3, 1, 'relink');
            expect(store.get('$.view.field')).toBe(3);
        });

        it('should call a listener registered on two affected aliases once', () => {
            store.link('$.view.row', '$.data.orders.k42');
            store.link('$.view.text', '$.view.row.total');
            const both = vi.fn();
            store.on(['$.view.row', '$.view.text'], both);

            store.link('$.view.row', '$.data.orders.k43');

            expect(both).toHaveBeenCalledTimes(1);
        });

        it('should not notify an alias that does not resolve through the re-pointed one', () => {
            store.link('$.view.row', '$.data.orders.k42');
            store.link('$.view.name', '$.data.name');
            const name = vi.fn();
            store.on('$.view.name', name);

            store.link('$.view.row', '$.data.orders.k43');

            expect(name).not.toHaveBeenCalled();
        });

        it('should read the same number of store entries in a store of 100 and of 100,000 entries', () => {
            const countReads = (size: number) => {
                let reads = 0;
                const entries: Record<string, { v: number }> = {};
                for (let i = 0; i < size; i++) {
                    entries[`e${i}`] = { v: i };
                }
                const counted = new Proxy(entries, {
                    get(target, prop, receiver) {
                        reads++;
                        return Reflect.get(target, prop, receiver);
                    },
                    has(target, prop) {
                        reads++;
                        return Reflect.has(target, prop);
                    },
                    ownKeys(target) {
                        reads++;
                        return Reflect.ownKeys(target);
                    }
                });
                const big = createStore<any>({ view: {} });
                big.set('$.entries', counted);
                big.link('$.view.slot', '$.entries.e0');
                const listeners = Array.from({ length: 20 }, () => vi.fn());
                listeners.forEach((listener, i) => big.on(`$.view.slot.p${i}`, listener));
                reads = 0;

                big.link('$.view.slot', '$.entries.e1');

                listeners.forEach((listener) => expect(listener).toHaveBeenCalledTimes(1));
                return reads;
            };

            const small = countReads(100);
            const large = countReads(100_000);

            expect(small).toBeGreaterThan(0);
            expect(large).toBe(small);
        });
    });

    describe('re-pointing through several aliases', () => {
        beforeEach(() => {
            store.set('$.data.orders.k43.address', { city: 'Bergen' });
            store.set('$.holder', {});
            store.set('$.app', {});
        });

        it('should notify a listener under an alias whose target lies under the re-pointed alias once', () => {
            store.link('$.app.current', '$.data.orders.k42');
            store.link('$.view.addr', '$.app.current.address');
            const listener = vi.fn();
            store.on('$.view.addr.city', listener);

            store.link('$.app.current', '$.data.orders.k43');

            expect(listener).toHaveBeenCalledTimes(1);
            expect(store.get('$.view.addr.city')).toBe('Bergen');
        });

        it('should notify a listener reached through an outer alias and an inner alias that leads through the re-pointed one once', () => {
            store.link('$.app.current', '$.data.orders.k42');
            store.link('$.app.record', '$.app.current');
            store.link('$.holder.address', '$.app.record.address');
            store.link('$.view.row', '$.holder');
            const listener = vi.fn();
            store.on('$.view.row.address.city', listener);

            store.link('$.app.current', '$.data.orders.k43');

            expect(listener).toHaveBeenCalledTimes(1);
            expect(store.get('$.view.row.address.city')).toBe('Bergen');
        });

        it('should notify a listener behind an outer alias and an inner alias once when the new target changes', () => {
            store.link('$.app.current', '$.data.orders.k42');
            store.link('$.app.record', '$.app.current');
            store.link('$.holder.address', '$.app.record.address');
            store.link('$.view.row', '$.holder');
            store.link('$.app.current', '$.data.orders.k43');
            const listener = vi.fn();
            store.on('$.view.row.address.city', listener);

            store.set('$.data.orders.k43.address.city', 'Tromso');

            expect(listener).toHaveBeenCalledTimes(1);
            expect(store.get('$.view.row.address.city')).toBe('Tromso');
        });

        it('should notify once through a chain of three aliases', () => {
            store.link('$.app.c1', '$.data.orders.k42');
            store.link('$.app.c2', '$.app.c1');
            store.link('$.app.c3', '$.app.c2');
            store.link('$.holder.address', '$.app.c3.address');
            store.link('$.view.row', '$.holder');
            const deep = vi.fn();
            store.on('$.view.row.address.city', deep);

            store.link('$.app.c1', '$.data.orders.k43');

            expect(deep).toHaveBeenCalledTimes(1);
            expect(store.get('$.view.row.address.city')).toBe('Bergen');
            expect(store.get('$.app.c3.address.city')).toBe('Bergen');
        });

        it('should notify once for a link whose target path passes through a re-pointed alias', () => {
            store.link('$.app.current', '$.data.orders.k42');
            store.link('$.holder.city', '$.app.current.address.city');
            store.link('$.view.row', '$.holder');
            const listener = vi.fn();
            store.on('$.view.row.city', listener);

            store.link('$.app.current', '$.data.orders.k43');

            expect(listener).toHaveBeenCalledTimes(1);
            expect(store.get('$.view.row.city')).toBe('Bergen');
        });
    });

    describe('allowMissing', () => {
        it('should refuse a missing target without the option', () => {
            expect(store.link('$.view.x', '$.data.orders.k42.x')).toBe(false);
        });

        it('should accept a missing target whose parent exists and read undefined', () => {
            const result = store.link('$.view.x', '$.data.orders.k42.x', { allowMissing: true });

            expect(result).toBe(true);
            expect(store.get('$.view.x')).toBeUndefined();
            expect('x' in store.state.view).toBe(false);
        });

        it('should refuse a missing target whose parent does not exist or is not an object', () => {
            expect(store.link('$.view.x', '$.data.nothing.x', { allowMissing: true })).toBe(false);
            expect(store.link('$.view.y', '$.data.name.x', { allowMissing: true })).toBe(false);
        });

        it('should notify the alias listener when the target appears, changes and goes', () => {
            store.link('$.view.x', '$.data.orders.k42.x', { allowMissing: true });
            const listener = vi.fn();
            store.on('$.view.x', listener);

            store.set('$.data.orders.k42.x', 1);
            store.set('$.data.orders.k42.x', 2);
            store.delete('$.data.orders.k42.x');

            expect(listener).toHaveBeenCalledTimes(3);
            expect(listener.mock.calls[0]).toEqual(['$.view.x', 1, undefined, 'insert']);
            expect(listener.mock.calls[1]).toEqual(['$.view.x', 2, 1, 'update']);
            expect(listener.mock.calls[2]).toEqual(['$.view.x', undefined, 2, 'delete']);
        });

        it('should read the target once it appears', () => {
            store.link('$.view.x', '$.data.orders.k42.x', { allowMissing: true });

            store.set('$.data.orders.k42.x', 'here');

            expect(store.get('$.view.x')).toBe('here');
        });

        it('should write through the alias to a missing target', () => {
            store.link('$.view.x', '$.data.orders.k42.x', { allowMissing: true });

            store.set('$.view.x', 5);

            expect(store.get('$.data.orders.k42.x')).toBe(5);
        });

        it('should notify the alias when a record holding the target is replaced', () => {
            store.link('$.view.x', '$.data.orders.k43.x', { allowMissing: true });
            const listener = vi.fn();
            store.on('$.view.x', listener);

            store.replace('$.data.orders.k43', { x: 9 });

            expect(listener).toHaveBeenCalledTimes(1);
            expect(store.get('$.view.x')).toBe(9);
        });

        it('should allow re-pointing to a missing target', () => {
            store.link('$.view.x', '$.data.orders.k42.total');
            const listener = vi.fn();
            store.on('$.view.x', listener);

            const result = store.link('$.view.x', '$.data.orders.k43.x', { allowMissing: true });

            expect(result).toBe(true);
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith('$.view.x', undefined, 10, 'relink');
            expect(store.get('$.view.x')).toBeUndefined();
        });
    });

    describe('protect', () => {
        it('should refuse a direct write and emit nothing', () => {
            store.protect('$.data.orders.k42');
            const listener = vi.fn();
            store.on('$.data.orders.k42.total', listener);
            store.on('$.data.orders.k42', listener);

            expect(store.set('$.data.orders.k42.total', 99)).toBe(false);
            expect(store.set('$.data.orders.k42', { total: 1 })).toBe(false);
            expect(store.apply('$.data.orders.k42', { total: 1 })).toBe(false);
            expect(store.applyIf('$.data.orders.k42', { extra: 1 })).toBe(false);
            expect(store.replace('$.data.orders.k42', { total: 1 })).toBe(false);
            expect(store.delete('$.data.orders.k42.total')).toBe(false);
            expect(store.delete('$.data.orders.k42')).toBe(false);

            expect(listener).not.toHaveBeenCalled();
            expect(store.get('$.data.orders.k42')).toEqual({ total: 10, address: { city: 'Oslo' } });
        });

        it('should refuse a write deep below the protected path', () => {
            store.protect('$.data.orders.k42');

            expect(store.set('$.data.orders.k42.address.city', 'Rome')).toBe(false);
            expect(store.get('$.data.orders.k42.address.city')).toBe('Oslo');
        });

        it('should ignore writes and deletes by proxy', () => {
            store.protect('$.data.orders.k42');

            store.get('$.data.orders.k42').total = 99;
            delete store.get('$.data.orders.k42').total;

            expect(store.get('$.data.orders.k42.total')).toBe(10);
        });

        it('should refuse a write through an alias to the protected path', () => {
            store.protect('$.data.orders.k42');
            store.link('$.view.order', '$.data.orders.k42');
            store.link('$.view.form', '$.view.order');
            const listener = vi.fn();
            store.on('$.view.order.total', listener);

            expect(store.set('$.view.order.total', 99)).toBe(false);
            expect(store.set('$.view.form.total', 99)).toBe(false);
            expect(store.delete('$.view.order.total')).toBe(false);
            expect(store.replace('$.view.order', { total: 1 })).toBe(false);

            expect(listener).not.toHaveBeenCalled();
            expect(store.get('$.data.orders.k42.total')).toBe(10);
        });

        it('should refuse a write through an alias that is re-pointed to a protected path', () => {
            store.protect('$.data.orders.k43');
            store.link('$.view.order', '$.data.orders.k42');
            store.link('$.view.order', '$.data.orders.k43');

            expect(store.set('$.view.order.total', 99)).toBe(false);
            expect(store.get('$.data.orders.k43.total')).toBe(20);
        });

        it('should still read, link to the path and notify listeners of a re-point', () => {
            store.protect('$.data.orders.k42');
            store.link('$.view.order', '$.data.orders.k42');
            const listener = vi.fn();
            store.on('$.view.order', listener);

            expect(store.get('$.data.orders.k42.total')).toBe(10);
            expect(store.get('$.view.order.total')).toBe(10);
            store.link('$.view.order', '$.data.orders.k43');

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('should leave other paths writable', () => {
            store.protect('$.data.orders.k42');

            expect(store.set('$.data.orders.k43.total', 1)).toBe(true);
            expect(store.set('$.data.name', 'Grace')).toBe(true);
        });

        it('should return false for an invalid path', () => {
            expect(store.protect('$.data..x')).toBe(false);
        });

        it('should accept a path without the root prefix', () => {
            store.protect('data.name');

            expect(store.set('$.data.name', 'Grace')).toBe(false);
        });
    });

    describe('unprotect', () => {
        it('should allow writes again, direct and through an alias', () => {
            store.protect('$.data.orders.k42');
            store.link('$.view.order', '$.data.orders.k42');

            const result = store.unprotect('$.data.orders.k42');

            expect(result).toBe(true);
            expect(store.set('$.data.orders.k42.total', 99)).toBe(true);
            expect(store.set('$.view.order.total', 100)).toBe(true);
            expect(store.get('$.data.orders.k42.total')).toBe(100);
        });

        it('should return false when the path is not protected', () => {
            expect(store.unprotect('$.data.name')).toBe(false);
        });
    });
});
