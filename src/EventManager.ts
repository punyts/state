import { report } from "@punyts/core";
import { createPathIndex } from "./PathIndex.js";

/**
 * A change listener. origin is the tag the write was made with (WriteOptions in the store), undefined for an untagged
 * write
 */
export type EventListenerFn = (path: string, value: any, oldValue: any, action: string, origin?: string) => void;

const PATT_HAS_WILDCARD = /[$]all|[$]every/;
const PATT_ALL_DOTS = /[.]/g;
const PATT_ALL_DOLLAR = /[$]/g;
const PATT_ALL_EVERY = /[$]every/g;
const PATT_ALL_ALL = /[$]all/g;

export interface EventTreeTarget {
    path: string;
    value: any;
    oldValue: any;
}

export interface EventManager {
    addListener: (path: string | string[], listener: EventListenerFn) => void;
    removeListener: (path: string | string[], listener?: EventListenerFn) => void;
    emit: (path: string | string[], value: any, oldValue: any, action: string, origin?: string) => void;
    emitTree: (path: string, value: any, oldValue: any, action: string, origin?: string) => void;
    emitTrees: (targets: EventTreeTarget[], action: string, origin?: string) => void;
}

export const createEventManager = (): EventManager => {
    ///LOGGING
    report("event-create", "Creating event manager");
    ///END LOGGING

    const listeners: Map<string, EventListenerFn[]> = new Map();
    const wildcards: Map<string, RegExp> = new Map();
    //every listened path, so a tree emit visits only the paths at and below its targets
    const keyIndex = createPathIndex<string>();
    //each wildcard path under its literal prefix (the segments before the first wildcard), so an emit tests only the wildcards that can match
    const wildcardIndex = createPathIndex<string>();
    //the order paths were first listened to, which is the order their listeners are called in
    const order: Map<string, number> = new Map();
    let nextOrder = 0;

    const byOrder = (a: string, b: string): number => order.get(a)! - order.get(b)!;

    const literalPrefix = (path: string): string => {
        const segments = path.split(".");
        const first = segments.findIndex((segment) => PATT_HAS_WILDCARD.test(segment));
        return segments.slice(0, first).join(".");
    };

    const removeKey = (path: string): void => {
        listeners.delete(path);
        order.delete(path);
        keyIndex.remove(path, path);
        if (wildcards.has(path)) {
            wildcards.delete(path);
            wildcardIndex.remove(literalPrefix(path), path);
        }
    };

    /**
     * The wildcard paths that may match the path, in the order they were first listened to: those whose literal prefix
     * is the path or lies above it
     */
    const wildcardsFor = (path: string): string[] => {
        if (wildcards.size === 0) {
            return [];
        }
        const found = [...wildcardIndex.at(path), ...wildcardIndex.at("")];
        for (const [, keys] of wildcardIndex.above(path)) found.push(...keys);
        return [...new Set(found)].sort(byOrder);
    };

    /**
     * Adds a listener for a specific path or wildcarded path.
     * @param path The path or wildcarded path to listen to.
     * @param listener The callback function to invoke when the event is emitted.
     */
    const addListener = (paths: string | string[], listener: EventListenerFn): void => {
        if (typeof paths !== "string" && !Array.isArray(paths)) debugger;
        ///LOGGING
        report("listener-add", "Add listener for %s", [paths]);
        ///END LOGGING

        if (!Array.isArray(paths)) {
            paths = [paths];
        }

        for (let path of paths) {
            if (!listeners.has(path)) {
                listeners.set(path, []);
                order.set(path, nextOrder++);
                keyIndex.add(path, path);
            }
            listeners.get(path)!.push(listener);

            //if there are wildcards then lets precompile the regexp
            if (path.match(PATT_HAS_WILDCARD) && !wildcards.has(path)) {
                const regExpPath = path
                    .replace(PATT_ALL_DOTS, "[.]")
                    .replace(PATT_ALL_EVERY, "(?:[^.]+)")
                    .replace(PATT_ALL_ALL, "(?:.+?)")
                    .replace(PATT_ALL_DOLLAR, "[$]");
                wildcards.set(path, new RegExp(`^${regExpPath}$`));
                wildcardIndex.add(literalPrefix(path), path);
            }
        }
    };

    /**
     * Removes a listener for a specific path or wildcarded path.
     * @param path The path or wildcarded path to remove the listener from.
     * @param listener The callback function to remove.
     */
    const removeListener = (paths: string | string[], listener?: EventListenerFn): void => {
        ///LOGGING
        report("listener-remove", "Remove listener for %s", [paths]);
        ///END LOGGING

        if (!Array.isArray(paths)) {
            paths = [paths];
        }

        for (let path of paths) {
            if (listeners.has(path)) {
                const pathListeners = listeners.get(path)!;
                if (listener) {
                    const index = pathListeners.indexOf(listener);
                    if (index !== -1) {
                        pathListeners.splice(index, 1);
                    }
                    //if this remove emptied the listeners for this path
                    if (pathListeners.length === 0) {
                        removeKey(path);
                    }
                }
                //if we didn't pass a listener function then remove all listeners for this path
                else {
                    removeKey(path);
                }
            }
        }
    };

    /**
     * Emits an event for a specific path, invoking all matching listeners.
     * @param path The path to emit the event for.
     * @param args The arguments to pass to the listeners.
     * @param origin The tag of the write, passed to every listener.
     */
    const emit = (paths: string | string[], newState: any, oldState: any, action: string, origin?: string): void => {
        ///LOGGING
        report("event-emit", "Emit event for %s to %", [paths, action]);
        ///END LOGGING

        const calledListeners = new Set<EventListenerFn>(); // Track listeners that have already been called

        if (!Array.isArray(paths)) {
            paths = [paths];
        }

        for (let path of paths) {
            // Emit for exact path match
            // iterate a snapshot so listeners added or removed by a callback can't shift the iteration and skip a neighbour;
            // a listener removed mid-emit still runs if it was in the snapshot, one added mid-emit waits for the next emit
            if (listeners.has(path)) {
                [...listeners.get(path)!].forEach((listener) => {
                    if (!calledListeners.has(listener)) {
                        callListener(listener, path, newState, oldState, action, origin);
                        calledListeners.add(listener);
                    }
                });
            }

            // Emit for wildcard matches
            wildcardsFor(path).forEach((key) => {
                const regExp = wildcards.get(key)!;
                if (key !== path && regExp.test(path)) {
                    ///LOGGING
                    report("event-emit-wildcard", "Emit event for %s using wildcard %s", [path, regExp.toString()]);
                    ///END LOGGING
                    //an earlier callback in this emit may have removed every listener for this wildcard
                    const pathListeners = listeners.get(key);
                    if (!pathListeners) {
                        return;
                    }
                    [...pathListeners].forEach((listener) => {
                        if (!calledListeners.has(listener)) {
                            callListener(listener, path, newState, oldState, action, origin);
                            calledListeners.add(listener);
                        }
                    });
                }
            });
        }
    };

    /**
     * Emits an event to every listener registered at the path or below it, each called once with the path given.
     * Used to tell the listeners of a link alias that the value behind the alias changed.
     * @param path The path whose listeners, and the listeners below it, are called.
     */
    const emitTree = (path: string, newState: any, oldState: any, action: string, origin?: string): void => {
        emitTrees([{ path, value: newState, oldValue: oldState }], action, origin);
    };

    /**
     * Emits one event per target in a single pass over the listeners: every listener registered at a target path or
     * below it is called once in total, with the path and values of the first target that reaches it.
     * Used when a re-pointed alias changes what several aliases show at once.
     * @param targets The paths to notify, with the value each one shows now and showed before.
     * @param action The action to report.
     * @param origin The tag of the write, passed to every listener.
     */
    const emitTrees = (targets: EventTreeTarget[], action: string, origin?: string): void => {
        ///LOGGING
        report("event-emit", "Emit tree event for %s to %", [targets.map((target) => target.path), action]);
        ///END LOGGING

        const calledListeners = new Set<EventListenerFn>();

        //each listened path takes the first target that reaches it: one at or above the path, or one its wildcard matches
        const reached = new Map<string, EventTreeTarget>();
        for (const target of targets) {
            for (const key of keyIndex.atOrBelow(target.path)) {
                if (!reached.has(key)) reached.set(key, target);
            }
            for (const key of wildcardsFor(target.path)) {
                if (!reached.has(key) && wildcards.get(key)!.test(target.path)) reached.set(key, target);
            }
        }

        //the listener lists are taken before any is called, as a callback may remove a path
        const lists = [...reached.keys()].sort(byOrder).map((key) => [key, listeners.get(key)!] as const);
        lists.forEach(([key, pathListeners]) => {
            const target = reached.get(key)!;
            [...pathListeners].forEach((listener) => {
                if (!calledListeners.has(listener)) {
                    callListener(listener, target.path, target.value, target.oldValue, action, origin);
                    calledListeners.add(listener);
                }
            });
        });
    };

    /**
     * Calls the listener handler function safely
     * @param listener
     * @param args
     */
    const callListener = (listener: EventListenerFn, path: string, newState: any, oldState: any, action: string, origin?: string) => {
        ///LOGGING
        report("event-call", "Calling event handler for %s to %s", [path, action]);
        ///END LOGGING

        try {
            //an untagged write calls the listener with the four arguments it always had
            if (origin === undefined) {
                listener(path, newState, oldState, action);
            }
            else {
                listener(path, newState, oldState, action, origin);
            }
        }
        catch (error) {
            report.error(error as Error);
        }
    }

    return {
        addListener,
        removeListener,
        emit,
        emitTree,
        emitTrees,
    };
};