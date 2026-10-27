import { describe, expect, it } from 'vitest';
import { createStore } from './Store.js';

type ArrayOp = (items: any[]) => unknown;

const MUTATORS: Readonly<Record<string, ArrayOp>> = Object.freeze({
    push: (items) => items.push('c'),
    pop: (items) => items.pop(),
    shift: (items) => items.shift(),
    unshift: (items) => items.unshift('z'),
    'splice remove': (items) => items.splice(1, 1),
    'splice insert': (items) => items.splice(1, 0, 'x'),
    'splice replace': (items) => items.splice(1, 1, 'x'),
    sort: (items) => items.sort(),
    reverse: (items) => items.reverse(),
});

/**
 * Runs op on a plain copy of initial and through a store proxy, recording every (path, action) emitted on the
 * array path and on its direct children
 */
const runThroughStore = (initial: readonly unknown[], op: ArrayOp) => {
    const plain = structuredClone([...initial]);
    const plainResult = op(plain);

    const store = createStore<any>({ items: structuredClone([...initial]) });
    const emits: string[] = [];
    const arrayPathActions: string[] = [];
    store.on('$.items', (path, _value, _old, action) => {
        emits.push(`${path} ${action}`);
        arrayPathActions.push(action);
    });
    store.on('$.items.$every', (path, _value, _old, action) => emits.push(`${path} ${action}`));

    const proxyResult = op(store.state.items);
    const items = store.get<any[]>('$.items');

    return {
        plain,
        plainResult,
        proxyResult,
        raw: [...items],
        keys: Object.keys(items),
        emits,
        arrayPathActions,
        store,
    };
};

describe('array mutators through a store proxy', () => {
    describe('final array matches a plain array', () => {
        const inputs: Readonly<Record<string, readonly unknown[]>> = Object.freeze({
            'primitives': Object.freeze(['b', 'c', 'a']),
            'duplicate primitives': Object.freeze(['a', 'a', 'b']),
            'duplicates at the ends': Object.freeze(['b', 'a', 'b']),
        });

        for (const [inputName, input] of Object.entries(inputs)) {
            for (const [mutatorName, op] of Object.entries(MUTATORS)) {
                it(`should match a plain array for ${mutatorName} on ${inputName}`, () => {
                    // Arrange / Act
                    const result = runThroughStore(input, op);

                    // Assert
                    expect(result.raw).toEqual(result.plain);
                    expect(result.keys).toEqual(Object.keys(result.plain));
                    expect(result.proxyResult).toEqual(result.plainResult);
                });
            }
        }

        for (const [mutatorName, op] of Object.entries(MUTATORS)) {
            it(`should match a plain array and keep element identity for ${mutatorName} on objects`, () => {
                // Arrange
                const objectOp: ArrayOp = (items) => {
                    //swap the primitive arguments for objects so inserted values are composite too
                    if (mutatorName === 'sort') {
                        return items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
                    }
                    if (mutatorName === 'push') return items.push({ id: 'd' });
                    if (mutatorName === 'unshift') return items.unshift({ id: 'z' });
                    if (mutatorName === 'splice insert') return items.splice(1, 0, { id: 'x' });
                    if (mutatorName === 'splice replace') return items.splice(1, 1, { id: 'x' });
                    return op(items);
                };
                const store = createStore<any>({ items: [{ id: 'b' }, { id: 'c' }, { id: 'a' }] });
                const originals = store.get<any[]>('$.items').map((item: { id: string }) => item.id);
                const plain = originals.map((id: string) => ({ id }));
                objectOp(plain);

                // Act
                objectOp(store.state.items);

                // Assert: same ids in the same order, and every element is still its own object
                const ids = store.get<any[]>('$.items').map((item: { id: string }) => item.id);
                expect(ids).toEqual(plain.map((item) => item.id));
                const raw = [...store.get<any[]>('$.items')];
                expect(new Set(raw.map((item) => item.id)).size).toBe(raw.length);
            });
        }
    });

    describe('every mutator notifies a listener on the array path', () => {
        for (const [mutatorName, op] of Object.entries(MUTATORS)) {
            it(`should call a $.items listener at least once for ${mutatorName}`, () => {
                // Arrange (sort needs an unsorted input to change anything)
                const input = mutatorName === 'sort' ? ['b', 'a', 'a'] : ['a', 'a', 'b'];

                // Act
                const result = runThroughStore(input, op);

                // Assert
                expect(result.arrayPathActions.length).toBeGreaterThan(0);
            });
        }
    });

    describe('emit sequences (characterisation)', () => {
        const expected: Readonly<Record<string, readonly string[]>> = Object.freeze({
            push: [
                '$.items.3 insert',
                '$.items insert-child',
            ],
            pop: [
                '$.items.2 delete',
                '$.items delete-child',
                '$.items.length update',
            ],
            shift: [
                '$.items.1 update',
                '$.items update-child',
                '$.items.2 delete',
                '$.items delete-child',
                '$.items.length update',
            ],
            unshift: [
                '$.items.3 insert',
                '$.items insert-child',
                '$.items.2 update',
                '$.items update-child',
                '$.items.0 update',
                '$.items update-child',
            ],
            'splice remove': [
                '$.items.1 update',
                '$.items update-child',
                '$.items.2 delete',
                '$.items delete-child',
                '$.items.length update',
            ],
            'splice insert': [
                '$.items.3 insert',
                '$.items insert-child',
                '$.items.2 update',
                '$.items update-child',
                '$.items.1 update',
                '$.items update-child',
            ],
            'splice replace': [
                '$.items.1 update',
                '$.items update-child',
            ],
            sort: [
                '$.items.0 update',
                '$.items update-child',
                '$.items.2 update',
                '$.items update-child',
            ],
            reverse: [
                '$.items.0 update',
                '$.items update-child',
                '$.items.2 update',
                '$.items update-child',
            ],
        });

        for (const [mutatorName, op] of Object.entries(MUTATORS)) {
            it(`should emit the recorded (path, action) sequence for ${mutatorName} on ['a', 'a', 'b']`, () => {
                // Arrange (sort uses ['b', 'a', 'a'] so it has something to reorder)
                const input = mutatorName === 'sort' ? ['b', 'a', 'a'] : ['a', 'a', 'b'];

                // Act
                const result = runThroughStore(input, op);

                // Assert: writes of an equal value at an index (e.g. shift's index 0) emit nothing
                expect(result.emits).toEqual(expected[mutatorName]);
            });
        }
    });

    describe('store.delete on an array element', () => {
        it('should remove the element at the index even when a duplicate comes first', () => {
            // Arrange
            const store = createStore<any>({ items: ['a', 'b', 'a', 'c'] });

            // Act
            const removed = store.delete('$.items.2');

            // Assert
            expect(removed).toBe(true);
            expect([...store.get<any[]>('$.items')]).toEqual(['a', 'b', 'c']);
        });
    });

    describe('replacing an array with a shorter one', () => {
        it('should leave only the new elements when set over a longer array', () => {
            // Arrange
            const store = createStore<any>({ items: [1, 2, 3] });

            // Act
            store.set('items', ['a']);

            // Assert
            expect([...store.get<any[]>('$.items')]).toEqual(['a']);
        });

        it('should leave only the new elements when set over a longer array of objects', () => {
            // Arrange
            const store = createStore<any>({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] });

            // Act
            store.set('$.items', [{ id: 9 }]);

            // Assert
            expect(store.get<any[]>('$.items').map((item: { id: number }) => item.id)).toEqual([9]);
        });
    });
});
