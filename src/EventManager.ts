import { report } from "@punyts/core";

export type EventListenerFn = (path: string, value: any, oldValue: any, action: string) => void;

const PATT_HAS_WILDCARD = /[$]all|[$]every/;
const PATT_ALL_DOTS = /[.]/g;
const PATT_ALL_DOLLAR = /[$]/g;
const PATT_ALL_EVERY = /[$]every/g;
const PATT_ALL_ALL = /[$]all/g;

export interface EventManager {
    addListener: (path: string | string[], listener: EventListenerFn) => void;
    removeListener: (path: string | string[], listener?: EventListenerFn) => void;
    emit: (path: string | string[], value: any, oldValue: any, action: string) => void;
}

export const createEventManager = (): EventManager => {
    ///LOGGING
    report("event-create", "Creating event manager");
    ///END LOGGING

    const listeners: Map<string, EventListenerFn[]> = new Map();
    const wildcards: Map<string, RegExp> = new Map();

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
            }
            listeners.get(path)!.push(listener);

            //if there are wildcards then lets precompile the regexp
            if (path.match(PATT_HAS_WILDCARD)) {
                const regExpPath = path
                    .replace(PATT_ALL_DOTS, "[.]")
                    .replace(PATT_ALL_EVERY, "(?:[^.]+)")
                    .replace(PATT_ALL_ALL, "(?:.+?)")
                    .replace(PATT_ALL_DOLLAR, "[$]");
                wildcards.set(path, new RegExp(`^${regExpPath}$`));
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
                        listeners.delete(path);
                        if (wildcards.has(path))
                            wildcards.delete(path);
                    }
                }
                //if we didn't pass a listener function then remove all listeners for this path
                else {
                    listeners.delete(path);
                    if (wildcards.has(path))
                        wildcards.delete(path);
                }
            }
        }
    };

    /**
     * Emits an event for a specific path, invoking all matching listeners.
     * @param path The path to emit the event for.
     * @param args The arguments to pass to the listeners.
     */
    const emit = (paths: string | string[], newState: any, oldState: any, action: string): void => {
        ///LOGGING
        report("event-emit", "Emit event for %s to %", [paths, action]);
        ///END LOGGING

        const calledListeners = new Set<EventListenerFn>(); // Track listeners that have already been called

        if (!Array.isArray(paths)) {
            paths = [paths];
        }

        for (let path of paths) {
            // Emit for exact path match
            if (listeners.has(path)) {
                listeners.get(path)!.forEach((listener) => {
                    if (!calledListeners.has(listener)) {
                        callListener(listener, path, newState, oldState, action);
                        calledListeners.add(listener);
                    }
                });
            }

            // Emit for wildcard matches
            wildcards.forEach((regExp, key) => {
                if (key !== path && regExp.test(path)) {
                    ///LOGGING
                    report("event-emit-wildcard", "Emit event for %s using wildcard %s", [path, regExp.toString()]);
                    ///END LOGGING
                    const pathListeners = listeners.get(key)!;
                    pathListeners.forEach((listener) => {
                        if (!calledListeners.has(listener)) {
                            callListener(listener, path, newState, oldState, action);
                            calledListeners.add(listener);
                        }
                    });
                }
            });
        }
    };

    /**
     * Calls the listener handler function safely
     * @param listener
     * @param args
     */
    const callListener = (listener: EventListenerFn, path: string, newState: any, oldState: any, action: string) => {
        ///LOGGING
        report("event-call", "Calling event handler for %s to %s", [path, action]);
        ///END LOGGING

        try {
            listener(path, newState, oldState, action);
        }
        catch (error) {
            report.error(error as Error);
        }
    }

    return {
        addListener,
        removeListener,
        emit,
    };
};