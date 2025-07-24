import { createEventManager, EventListenerFn } from './EventManager';

describe('EventManager', () => {
    let eventManager: ReturnType<typeof createEventManager>;

    beforeEach(() => {
        eventManager = createEventManager();
    });

    test('should add a listener for a specific path', () => {
        const listener: EventListenerFn = jest.fn();
        eventManager.addListener('test.path', listener);

        // Emit the event to verify the listener is called
        eventManager.emit('test.path', { data: 'new' }, { data: 'old' }, "update");
        expect(listener).toHaveBeenCalledWith('test.path', { data: 'new' }, { data: 'old' }, "update");
    });

    test('should add a listener for multiple paths', () => {
        const listener: EventListenerFn = jest.fn();
        eventManager.addListener(['path.one', 'path.two'], listener);

        // Emit events for both paths
        eventManager.emit('path.one', { data: 'new' }, { data: 'old' }, "update");
        eventManager.emit('path.two', { data: 'new' }, { data: 'old' }, "update");

        expect(listener).toHaveBeenCalledTimes(2);
    });

    test('should remove a listener for a specific path', () => {
        const listener: EventListenerFn = jest.fn();
        eventManager.addListener('test.path', listener);

        // Remove the listener
        eventManager.removeListener('test.path', listener);

        // Emit the event to verify the listener is not called
        eventManager.emit('test.path', { data: 'new' }, { data: 'old' }, "update");
        expect(listener).not.toHaveBeenCalled();
    });

    test('should remove a listener for multiple paths', () => {
        const listener: EventListenerFn = jest.fn();
        eventManager.addListener(['path.one', 'path.two'], listener);

        // Remove the listener from both paths
        eventManager.removeListener(['path.one', 'path.two'], listener);

        // Emit events for both paths
        eventManager.emit('path.one', { data: 'new' }, { data: 'old' }, "update");
        eventManager.emit('path.two', { data: 'new' }, { data: 'old' }, "update");

        expect(listener).not.toHaveBeenCalled();
    });

    test('should handle wildcard listeners', () => {
        const listener: EventListenerFn = jest.fn();
        eventManager.addListener('$all', listener);

        // Emit events for different paths
        eventManager.emit('any.path', { data: 'new' }, { data: 'old' }, "update");
        eventManager.emit('another.path', { data: 'new' }, { data: 'old' }, "update");

        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenCalledWith('any.path', { data: 'new' }, { data: 'old' }, "update");
        expect(listener).toHaveBeenCalledWith('another.path', { data: 'new' }, { data: 'old' }, "update");
    });

    test('should handle wildcard listeners with $every', () => {
        const listener: EventListenerFn = jest.fn();
        eventManager.addListener('$every.path', listener);

        // Emit events for matching paths
        eventManager.emit('test.path', { data: 'new' }, { data: 'old' }, "update");
        eventManager.emit('another.path', { data: 'new' }, { data: 'old' }, "update");

        expect(listener).toHaveBeenCalledTimes(2);
    });

    test('should not call removed wildcard listeners', () => {
        const listener: EventListenerFn = jest.fn();
        eventManager.addListener('$all', listener);

        // Remove the wildcard listener
        eventManager.removeListener('$all', listener);

        // Emit events for different paths
        eventManager.emit('any.path', { data: 'new' }, { data: 'old' }, "update");
        eventManager.emit('another.path', { data: 'new' }, { data: 'old' }, "update");

        expect(listener).not.toHaveBeenCalled();
    });

    test('should handle errors in listener safely', () => {
        const errorListener: EventListenerFn = jest.fn(() => {
            throw new Error('Listener error');
        });
        const safeListener: EventListenerFn = jest.fn();

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
        const listenerOne: EventListenerFn = jest.fn();
        const listenerTwo: EventListenerFn = jest.fn();

        eventManager.addListener('test.path', listenerOne);
        eventManager.addListener('test.path', listenerTwo);

        // Emit the event
        eventManager.emit('test.path', { data: 'new' }, { data: 'old' }, "update");

        expect(listenerOne).toHaveBeenCalledWith('test.path', { data: 'new' }, { data: 'old' }, "update");
        expect(listenerTwo).toHaveBeenCalledWith('test.path', { data: 'new' }, { data: 'old' }, "update");
    });

    test('should not call the same listener twice for the same event', () => {
        const listener: EventListenerFn = jest.fn();

        eventManager.addListener('test.path', listener);
        eventManager.addListener('$all', listener);

        // Emit the event
        eventManager.emit('test.path', { data: 'new' }, { data: 'old' }, "update");

        // Listener should only be called once
        expect(listener).toHaveBeenCalledTimes(1);
    });
});