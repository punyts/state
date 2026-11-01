import { beforeEach, describe, expect, it, test, vi } from 'vitest';
import { createEventManager, EventListenerFn } from './EventManager.js';

describe('EventManager', () => {
    let eventManager: ReturnType<typeof createEventManager>;

    beforeEach(() => {
        eventManager = createEventManager();
    });

    test('should add a listener for a specific path', () => {
        const listener: EventListenerFn = vi.fn();
        eventManager.addListener('test.path', listener);

        // Emit the event to verify the listener is called
        eventManager.emit('test.path', { data: 'new' }, { data: 'old' }, "update");
        expect(listener).toHaveBeenCalledWith('test.path', { data: 'new' }, { data: 'old' }, "update");
    });

    test('should add a listener for multiple paths', () => {
        const listener: EventListenerFn = vi.fn();
        eventManager.addListener(['path.one', 'path.two'], listener);

        // Emit events for both paths
        eventManager.emit('path.one', { data: 'new' }, { data: 'old' }, "update");
        eventManager.emit('path.two', { data: 'new' }, { data: 'old' }, "update");

        expect(listener).toHaveBeenCalledTimes(2);
    });

    test('should remove a listener for a specific path', () => {
        const listener: EventListenerFn = vi.fn();
        eventManager.addListener('test.path', listener);

        // Remove the listener
        eventManager.removeListener('test.path', listener);

        // Emit the event to verify the listener is not called
        eventManager.emit('test.path', { data: 'new' }, { data: 'old' }, "update");
        expect(listener).not.toHaveBeenCalled();
    });

    test('should remove a listener for multiple paths', () => {
        const listener: EventListenerFn = vi.fn();
        eventManager.addListener(['path.one', 'path.two'], listener);

        // Remove the listener from both paths
        eventManager.removeListener(['path.one', 'path.two'], listener);

        // Emit events for both paths
        eventManager.emit('path.one', { data: 'new' }, { data: 'old' }, "update");
        eventManager.emit('path.two', { data: 'new' }, { data: 'old' }, "update");

        expect(listener).not.toHaveBeenCalled();
    });

    test('should handle wildcard listeners', () => {
        const listener: EventListenerFn = vi.fn();
        eventManager.addListener('$all', listener);

        // Emit events for different paths
        eventManager.emit('any.path', { data: 'new' }, { data: 'old' }, "update");
        eventManager.emit('another.path', { data: 'new' }, { data: 'old' }, "update");

        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenCalledWith('any.path', { data: 'new' }, { data: 'old' }, "update");
        expect(listener).toHaveBeenCalledWith('another.path', { data: 'new' }, { data: 'old' }, "update");
    });

    test('should handle wildcard listeners with $every', () => {
        const listener: EventListenerFn = vi.fn();
        eventManager.addListener('$every.path', listener);

        // Emit events for matching paths
        eventManager.emit('test.path', { data: 'new' }, { data: 'old' }, "update");
        eventManager.emit('another.path', { data: 'new' }, { data: 'old' }, "update");

        expect(listener).toHaveBeenCalledTimes(2);
    });

    test('should not call removed wildcard listeners', () => {
        const listener: EventListenerFn = vi.fn();
        eventManager.addListener('$all', listener);

        // Remove the wildcard listener
        eventManager.removeListener('$all', listener);

        // Emit events for different paths
        eventManager.emit('any.path', { data: 'new' }, { data: 'old' }, "update");
        eventManager.emit('another.path', { data: 'new' }, { data: 'old' }, "update");

        expect(listener).not.toHaveBeenCalled();
    });

    test('should handle errors in listener safely', () => {
        const errorListener: EventListenerFn = vi.fn(() => {
            throw new Error('Listener error');
        });
        const safeListener: EventListenerFn = vi.fn();

        eventManager.addListener('test.path', errorListener);
        eventManager.addListener('test.path', safeListener);

        // Emit the event
        expect(() => {
            eventManager.emit('test.path', { data: 'new' }, { data: 'old' }, "update");
        }).not.toThrow();

        // Verify the safe listener is still called
        expect(safeListener).toHaveBeenCalledWith('test.path', { data: 'new' }, { data: 'old' }, "update");
    });

    test('should handle emitting to multiple listeners', () => {
        const listenerOne: EventListenerFn = vi.fn();
        const listenerTwo: EventListenerFn = vi.fn();

        eventManager.addListener('test.path', listenerOne);
        eventManager.addListener('test.path', listenerTwo);

        // Emit the event
        eventManager.emit('test.path', { data: 'new' }, { data: 'old' }, "update");

        expect(listenerOne).toHaveBeenCalledWith('test.path', { data: 'new' }, { data: 'old' }, "update");
        expect(listenerTwo).toHaveBeenCalledWith('test.path', { data: 'new' }, { data: 'old' }, "update");
    });

    test('should not call the same listener twice for the same event', () => {
        const listener: EventListenerFn = vi.fn();

        eventManager.addListener('test.path', listener);
        eventManager.addListener('$all', listener);

        // Emit the event
        eventManager.emit('test.path', { data: 'new' }, { data: 'old' }, "update");

        // Listener should only be called once
        expect(listener).toHaveBeenCalledTimes(1);
    });

    describe('re-entrant listener changes during emit', () => {
        it('should call every snapshotted listener once when a listener removes itself and a neighbour', () => {
            // Arrange
            const calls: string[] = [];
            const listenerB: EventListenerFn = vi.fn(() => calls.push('B'));
            const listenerC: EventListenerFn = vi.fn(() => calls.push('C'));
            const listenerA: EventListenerFn = vi.fn(() => {
                calls.push('A');
                eventManager.removeListener('test.path', listenerA);
                eventManager.removeListener('test.path', listenerB);
            });
            eventManager.addListener('test.path', listenerA);
            eventManager.addListener('test.path', listenerB);
            eventManager.addListener('test.path', listenerC);

            // Act
            eventManager.emit('test.path', 1, 0, "update");

            // Assert: B was in the snapshot, so it still runs for this emit
            expect(calls).toEqual(['A', 'B', 'C']);
            expect(listenerA).toHaveBeenCalledTimes(1);
            expect(listenerB).toHaveBeenCalledTimes(1);
            expect(listenerC).toHaveBeenCalledTimes(1);
        });

        it('should only call the remaining listener on the next emit after removals', () => {
            // Arrange
            const listenerB: EventListenerFn = vi.fn();
            const listenerC: EventListenerFn = vi.fn();
            const listenerA: EventListenerFn = vi.fn(() => {
                eventManager.removeListener('test.path', listenerA);
                eventManager.removeListener('test.path', listenerB);
            });
            eventManager.addListener('test.path', listenerA);
            eventManager.addListener('test.path', listenerB);
            eventManager.addListener('test.path', listenerC);
            eventManager.emit('test.path', 1, 0, "update");

            // Act
            eventManager.emit('test.path', 2, 1, "update");

            // Assert
            expect(listenerA).toHaveBeenCalledTimes(1);
            expect(listenerB).toHaveBeenCalledTimes(1);
            expect(listenerC).toHaveBeenCalledTimes(2);
        });

        it('should not call a listener added during an emit until the next emit', () => {
            // Arrange
            const added: EventListenerFn = vi.fn();
            const adder: EventListenerFn = vi.fn(() => {
                eventManager.addListener('test.path', added);
            });
            eventManager.addListener('test.path', adder);

            // Act
            eventManager.emit('test.path', 1, 0, "update");

            // Assert
            expect(added).not.toHaveBeenCalled();
            eventManager.removeListener('test.path', adder);
            eventManager.emit('test.path', 2, 1, "update");
            expect(added).toHaveBeenCalledTimes(1);
        });

        it('should skip a wildcard whose listeners were all removed earlier in the same emit', () => {
            // Arrange
            const wildcardListener: EventListenerFn = vi.fn();
            const remover: EventListenerFn = vi.fn(() => {
                eventManager.removeListener('test.$all', wildcardListener);
            });
            eventManager.addListener('test.path', remover);
            eventManager.addListener('test.$all', wildcardListener);

            // Act
            const act = () => eventManager.emit('test.path', 1, 0, "update");

            // Assert
            expect(act).not.toThrow();
            expect(remover).toHaveBeenCalledTimes(1);
            expect(wildcardListener).not.toHaveBeenCalled();
        });
    });

    describe('indexed lookups', () => {
        it('should call tree listeners in the order their paths were first listened to', () => {
            // Arrange
            const calls: string[] = [];
            eventManager.addListener('$.a.z', () => calls.push('z'));
            eventManager.addListener('$.a', () => calls.push('a'));
            eventManager.addListener('$.a.$every', () => calls.push('every'));
            eventManager.addListener('$.a.b', () => calls.push('b'));
            eventManager.addListener('$.other', () => calls.push('other'));

            // Act
            eventManager.emitTree('$.a', 1, 0, 'relink');

            // Assert
            expect(calls).toEqual(['z', 'a', 'every', 'b']);
        });

        it('should give each tree listener the first target that reaches it, a wildcard included', () => {
            // Arrange
            const listener: EventListenerFn = vi.fn();
            eventManager.addListener('$.list.$every.name', listener);

            // Act
            eventManager.emitTrees([{ path: '$.list.2.name', value: 'b', oldValue: 'a' }, { path: '$.list', value: [], oldValue: [] }], 'relink');

            // Assert
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith('$.list.2.name', 'b', 'a', 'relink');
        });

        it('should match a wildcard that has no literal prefix and stop after it is removed', () => {
            // Arrange
            const listener: EventListenerFn = vi.fn();
            eventManager.addListener('$all.name', listener);

            // Act
            eventManager.emit('$.people.0.name', 'x', 'y', 'update');
            eventManager.removeListener('$all.name', listener);
            eventManager.emit('$.people.0.name', 'z', 'x', 'update');

            // Assert
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('should order a wildcard listened to again after its listeners were removed as a new path', () => {
            // Arrange
            const calls: string[] = [];
            const first = (): void => { calls.push('first'); };
            eventManager.addListener('$.a.$every', first);
            eventManager.addListener('$.a.$all', () => calls.push('all'));
            eventManager.removeListener('$.a.$every', first);
            eventManager.addListener('$.a.$every', () => calls.push('again'));

            // Act
            eventManager.emit('$.a.b', 1, 0, 'update');

            // Assert
            expect(calls).toEqual(['all', 'again']);
        });
    });
});