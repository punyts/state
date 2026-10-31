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

        it('should return false when the alias already is an alias or holds data', () => {
            store.link('$.view.field', '$.data.name');

            expect(store.link('$.view.field', '$.data.orders')).toBe(false);
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
});
