import { report, getType } from '@punyts/core';
import { applyToState, applyToStateIf, replaceState } from './ApplyState.js';
import { createEventManager, EventManager, EventListenerFn } from './EventManager.js';

const PATT_STATE_PATH = /^(?:(?:[0-z$\-_]+)(?:[.](?!$)|$))+$/;
const PATT_LEADING_DOTS = /^([.]+)(.*)/;

export interface Store<R> {
    get: <T = any>(path: string) => T & ProxyObject;
    set: <T = any>(path: string, value: Partial<T>) => boolean;
    delete: (path: string) => boolean;
    on: (path: string | string[], listener: EventListenerFn) => void;
    off: (path: string | string[], listener?: EventListenerFn) => void;
    keys: <T = any>(path: string) => (string | number | Symbol)[];
    apply: (path: string, source: any) => void;
    applyIf: (path: string, source: any) => void;
    isRefMatch: (path: string, source: any) => boolean;
    replace: (path: string, source: any) => void;
    state: R;
}

export type ProxyObject = {
    readonly __on: (path: string | string[], listener: EventListenerFn) => void;
    readonly __off: (path: string | string[], listener?: EventListenerFn) => void;
    readonly __keys: (string | number | Symbol)[];
    readonly __isProxy: boolean;
    readonly __type: string;
    readonly __path: string;
    readonly __get: <T>(path: string) => T & ProxyObject;
    readonly __set: <T = any>(path: string, value: Partial<T>) => boolean;
    readonly __isRefMatch: (source: any) => boolean;
    readonly __apply: (value: any) => any;
    readonly __applyIf: (value: any) => any;
    readonly __replace: (value: any) => any;
};

export type DeepProxyObject<T = any> = (
    T extends object
    ? { [K in keyof T]: DeepProxyObject<T[K]> & ProxyObject }
    : T
);

interface StateRef {
    parent: any;
    index: string | null;
    value: any;
    found: boolean
}

const structuredCloneFn = (globalThis as { structuredClone?: <T>(value: T) => T }).structuredClone;

const getDebugStack = () => {
    const stack = new Error().stack;
    if (!stack) {
        return "stack-unavailable";
    }
    return stack
        .split("\n")
        .slice(2, 7)
        .map((line) => line.trim())
        .join(" | ");
};

const cloneValue = <T>(value: T, seen: WeakMap<object, any> = new WeakMap()): T => {
    if (value === undefined || value === null) {
        return value;
    }

    const valueType = typeof value;
    if (valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') {
        return value;
    }

    if (typeof structuredCloneFn === 'function') {
        try {
            return structuredCloneFn(value);
        }
        catch {
            // fall back to manual cloning
        }
    }

    if (valueType !== 'object') {
        return value;
    }

    const objectValue = value as object;
    if (seen.has(objectValue)) {
        return seen.get(objectValue);
    }
    if (Array.isArray(value)) {
        const cloned: any[] = [];
        seen.set(objectValue, cloned);
        for (const item of value as any[]) {
            cloned.push(cloneValue(item, seen));
        }
        return cloned as T;
    }

    const cloned: Record<PropertyKey, any> = {};
    seen.set(objectValue, cloned);
    for (const key of Reflect.ownKeys(objectValue)) {
        cloned[key as any] = cloneValue((objectValue as any)[key], seen);
    }

    return cloned as T;
};

/**
 * If the target is a proxy it gets the target's raw type, otherwise it gets the type of the target
 * @param target
 * @returns
 */
export const getRawType = (target: any) => {
    return target?.__isProxy
        ? target.__type
        : getType(target);
}

const isComposite = (value: any) => {
    const type = getRawType(value);
    return type === "object" || type === "array";
};

/**
 * Returns true if the path is valid
 * @param path
 * @returns
 */
export const validatePath = (path: string) => {
    return PATT_STATE_PATH.test(path);
}

/**
 * Takes a path or array of paths and ensures they are fully resolved using the basePath to resolve any relative paths
 * @param basePath
 * @param paths
 */
export const resolveRelativePath = (basePath: string, paths: string | string[]) => {
    if (!Array.isArray(paths)) {
        paths = [paths];
    }
    for (let index in paths) {
        const listenToPath = paths[index];

        //relative paths start with a dot
        const match = listenToPath.match(PATT_LEADING_DOTS);
        if (!match) {
            continue;
        }

        const relativePath = match[2]
            .replace(/\[["'`"]/g, ".") //remove the indexer pattern []
            .replace(/["'`"]\]/g, "");

        const basePathSegs = basePath.split(".");
        let dotCount = match[1].length - 1; // the first dot doesn't count
        //use the dot count to remove segments from the base path
        while (dotCount > 0) {
            dotCount--;
            basePathSegs.pop();
        }
        const modBasePath = basePathSegs.join(".");
        if (relativePath)
            paths[index] = `${modBasePath}.${relativePath}`;
        else
            paths[index] = modBasePath;
    }

    return paths;
}

export const createStore = <R>(initialState?: R): Store<R> => {
    let state: R = initialState
        ? cloneValue(
            initialState
        ) : {} as R;
    const eventManager: EventManager = createEventManager();

    /**
     * Takes the last segment off of the path, returns the last segment as the index and the remaining segments as the basePath
     * @param fullPath
     */
    const getParentAndPropName = (fullPath: string) => {
        const segs = fullPath.split(".");

        //if there are no segments then the propName will be and empty string
        if (segs.length === 1) {
            return {
                propName: "",
                basePath: fullPath
            }
        }

        const propName = segs.pop() as string;
        const basePath = segs.join(".");

        return {
            propName,
            basePath
        };
    }

    /**
     * This unwraps any proxy objects and returns their raw state value
     * @param value
     */
    const getRawValue = (value: any) => {
        if (value && typeof value === "object") {
            if (value.__isProxy) {
                return getStateByPath(value.__path);
            }
        }
        return value;
    }

    /**
     * Retrieves a reference to a property in the state using a path.
     * Returns the parent object, index (if applicable), the property value, and a found indicator.
     * @param path - The path to the desired property in dot notation (e.g., "user.profile.name")
     * @returns {object} - An object containing the parent, index, value, and found indicator
     */
    const getStateRef = (path: string): StateRef => {
        if (!path || typeof path !== 'string') {
            throw new Error('Invalid path provided');
        }

        //return the root state
        if (path === "$") {
            return { parent: { $: state }, index: "$", value: state, found: true };;
        }

        // Normalize the path to remove leading "$." if present
        const normalizedPath = path.startsWith('$.') ? path.slice(2) : path;

        // Split the path into segments
        const segments = normalizedPath.split('.');

        // Traverse the state object to the second-to-last segment
        let current: any = state;
        let parent: any = null;
        let index: string | null = null;
        const len = segments.length;

        for (let i = 0; i < len; i++) {
            const segment = segments[i];

            if (segment in current) {
                parent = current;
                index = segment;
                current = current[segment];
            }
            else {
                // If the path does not exist, return a not found indicator
                return { parent: null, index: null, value: undefined, found: false };
            }
        }

        // Return the parent, index, value, and found indicator
        return { parent, index, value: current, found: true };
    };

    /**
     * Returns the property value from the root state at path
     * @param path
     */
    const getStateByPath = (path: any) => {
        return getStateRef(path).value;
    }

    /**
     * Sets the property value in the root state at the specified path
     * @param fullPath - The path to the desired property in dot notation (e.g., "user.profile.name")
     * @param value - The value to set at the specified path
     * @returns {boolean} - Returns true if the value was successfully set, false otherwise
     */
    const setStateByPath = <T>(
        basePath: string, 
        propName: string, 
        value: any, 
        overwrite: boolean, 
        remove: boolean
    ): boolean => {
        basePath = basePath.startsWith("$")
            ? basePath
            : `$.${basePath}`;

        const fullPath = propName
            ? `${basePath}.${propName}`
            : basePath;

        //get the state for the basePath
        const { value: base, found: baseFound } = getStateRef(basePath);

        //if the base path isn't found then we can't do anything, set fails
        if (!baseFound) {
            return false;
        }

        //if the base value is not an array or object then we can't set a property, set fails
        if (!base || typeof base !== "object") {
            return false;
        }

        //Unwrap the value if it's a proxy
        const rawValue = getRawValue(value);
        const rawValueType = getRawType(rawValue);
        const rawValueIsComposite = ["object", "array"].includes(rawValueType);

        //if this is the root state then there won't be a propName
        const currentValue = propName
            ? base[propName]
            : base;
        const currentValueType = getRawType(currentValue);
        const currentIsComposite = ["object", "array"].includes(currentValueType);

        //if the values are equal then nothing to do
        if (rawValue === currentValue) {
            return true;
        }

        ///LOGGING
        report("state-set-extended", "Set %s to %s", [fullPath, value]);
        ///END LOGGING

        //get a copy of the current value to use as the oldValue when emitting the event
        const oldValue = cloneValue(currentValue);
        const hasProp = propName
            ? base.hasOwnProperty(propName)
            : true;

        ///LOGGING
        if (!overwrite && !remove) {
            const prop = propName ?? "<root>";
            report("state-set", "setStateByPath applyIf %s.%s hasProp %s", [basePath, prop, String(hasProp)]);
        }
        ///END LOGGING

        //when both the current and new values are objects, they need to be merged
        if (rawValueIsComposite && currentIsComposite) {
            const proxy = createProxy<T>(currentValue, fullPath)
            if (remove) {
                //using a proxy for the current state will cause change events to be fired for anything that changes downstream
                replaceState(
                    proxy,
                    rawValue
                );
            }
            else if (overwrite) {
                applyToState(
                    proxy,
                    rawValue
                );
            }
            else {
                console.log("Applying state if condition", rawValue);
                applyToStateIf(
                    proxy,
                    rawValue
                );
            }

        }
        //when we have a prop name we're updaing a value directly
        else if (propName && overwrite && remove) {
            base[propName] = rawValue;
        }
        //if we made it here it's because the path = $, root, and the raw value is not an object
        else {
            throw new Error(`Invalid update for ${fullPath}`);
        }

        // Emit an event for the updated path
        // the rawValue, the new state value, should be wrapped in a proxy, the currentValue, aka oldValue, is a raw object
        // this should only fire if we are doing a replace
        if (overwrite && remove) {
            eventManager.emit(
                fullPath,
                rawValueIsComposite
                    ? createProxy<T>(rawValue, fullPath)
                    : rawValue,
                oldValue,
                hasProp ? "update" : "insert"
            );

            //if we are adding a new object to the basePath then we need to fire an event for that
            if (!hasProp && rawValueIsComposite) {
                eventManager.emit(
                    basePath,
                    createProxy<T>(base, basePath),
                    undefined,
                    "insert-child"
                );
            }
        }

        return true;
    };

    /**
     * Deletes the property
     * @param basePath
     * @param propName
     * @returns
     */
    const deleteStateByPath = (basePath: string, propName: string): boolean => {
        basePath = basePath.startsWith("$")
            ? basePath
            : `$.${basePath}`;

        const fullPath = propName
            ? `${basePath}.${propName}`
            : basePath;

        const stateRef = getStateRef(fullPath);
        if (!stateRef.found)
            return false;

        const oldValue = cloneValue(stateRef.parent[stateRef.index as string]);

        //if the parent is an array then we need to splice
        if (Array.isArray(stateRef.parent)) {
            stateRef.parent.splice(stateRef.parent.indexOf(stateRef.value), 1);
        }
        //otherwise we can delete it outright
        else {
            delete stateRef.parent[stateRef.index as string];
        }

        eventManager.emit(
            fullPath,
            undefined,
            oldValue,
            "delete"
        );

        //emit an event for the base path since it is changing as well
        if (basePath !== fullPath) {
            eventManager.emit(
                basePath,
                undefined,
                oldValue,
                "delete-child"
            );
        }

        return true;

    }

    /**
     * Checks the internal raw version of the state with another object
     * @param value
     * @param otherValue
     * @returns
     */
    const isRefMatch = <T>(path: string, source: T) => {
        const target = getStateByPath(path);

        //if the other source is an object or array then let's check the reference
        if (isComposite(source)) {
            return getRawValue(source) === target;
        }
        return false;
    }

    /**
     * If the prop is on of the proxy meta properties, return that, otherwise return undefined
     * @param basePath
     * @param prop
     * @param value
     * @returns
     */
    const getProxyProp = <T>(basePath: string, prop: string, value: any) => {
        // Handle dynamic `on` and `off` methods
        if (prop === '__on') {
            return (paths: string | string[], listener: EventListenerFn) => {
                const fullPaths = resolveRelativePath(basePath, paths);
                eventManager.addListener(fullPaths, listener);
            }
        }
        if (prop === '__off') {
            return (paths: string | string[], listener: EventListenerFn) => {
                const fullPaths = resolveRelativePath(basePath, paths);
                eventManager.removeListener(fullPaths, listener);
            }
        }

        //give the proxy some contextual props
        if (prop === "__isProxy") {
            return true;
        }
        if (prop === "__type") {
            return getType(value);
        }
        if (prop === "__path") {
            return basePath;
        }
        if (prop === "__isRefMatch") {
            return (source: T) => {
                return isRefMatch<T>(basePath, source);
            }
        }
        if (prop === "__keys") {
            return (() => {
                return keys<T>(basePath);
            })();
        }
        if (prop === "__apply") {
            return (source: any) => {
                return apply<T>(basePath, source);
            }
        }
        if (prop === "__applyIf") {
            return (source: any) => {
                return applyIf<T>(basePath, source);
            }
        }
        if (prop === "__replace") {
            return (source: any) => {
                return replace<T>(basePath, source);
            }
        }
        if (prop === "__get") {
            return (path: string) => {
                const fullPath = resolveRelativePath(basePath, path)[0];
                return get(fullPath) as T;
            }
        }
        if (prop === "__set") {
            return (path: string, value: any) => {
                const fullPath = resolveRelativePath(basePath, path)[0];
                return set<T>(fullPath, value);
            }
        }

        return undefined;
    }

    /**
     * Creates a proxy object for the target at base path
     * @param target
     * @param basePath
     * @returns
     */
    const createProxy = <T>(target: any, basePath: string): T & ProxyObject => {
        return new Proxy(target, {
            get(obj, propName) {
                //we don't support symbols
                if (typeof propName !== 'string') {
                    return obj[propName];
                }

                const fullPath = `${basePath}.${propName}`;
                //if the property is in the target then use that
                if (propName in obj) {
                    const value = obj[propName];
                    //for generic arrays and objects create a proxy (skips things like elements)
                    if (isComposite(value)) {
                        return createProxy<T>(value, fullPath);
                    }
                    return value;
                }
                //otherwise lets see if the prop matches one of the proxy properties
                return getProxyProp(basePath, propName, obj);
            },
            has(obj, propName) {
                if (typeof propName !== "string") {
                    return propName in obj;
                }

                if (propName in obj) {
                    return true;
                }

                return getProxyProp(basePath, propName, obj) !== undefined;
            },
            set(obj, propName, value) {
                //we don't support symbols
                if (typeof propName !== 'string') {
                    return false;
                }

                ///LOGGING
                report("state-set", "Set by proxy %s", [`${basePath}.${propName}`]);
                ///END LOGGING

                setStateByPath(basePath, propName, value, true, true);

                return true;
            },
            deleteProperty(obj, propName) {
                //we don't support symbols
                if (typeof propName !== 'string') {
                    return false;
                }

                ///LOGGING
                report("state-set", "Delete by proxy %s", [`${basePath}.${propName}`]);
                ///END LOGGING

                return deleteStateByPath(basePath, propName);
            }
        });
    };

    /**
     * Recursively applies the properties from source to the target object if the target doesn't have that property
     * Change event will be fires for any changes
     * @param state
     * @param newState
     */
    const applyIf = <T = any>(path: string, source: any) => {
        ///LOGGING
        report("state-set", "ApplyIf to %s", [path]);
        report("state-set", "ApplyIf stack %s", [getDebugStack()]);
        if (source && typeof source === "object") {
            const keys = Object.keys(source as object).join(",") || "<none>";
            report("state-set", "ApplyIf keys %s", [keys]);
        }
        ///END LOGGING

        const { basePath, propName } = getParentAndPropName(path);
        return setStateByPath(basePath, propName, source, false, false);
    }

    /**
     * Recursively applies the properties from source to the target object 
     * Change event will be fires for any changes
     * @param path
     * @param source
     */
    const apply = <T = any>(path: string, source: any) => {
        ///LOGGING
        report("state-set", "Apply to %s", [path]);
        ///END LOGGING

        const { basePath, propName } = getParentAndPropName(path);
        return setStateByPath(basePath, propName, source, true, false);
    }

    /**
     * Replaces the value at path with source, overwriting objects and arrays rather than applying the source props to target
     * @param path
     * @param source
     */
    const replace = <T = any>(path: string, source: any) => {
        const target = getStateByPath(path);
        const sourceType = getRawType(source);

        //don't use replace for primitives, just use set
        if (!isComposite(target) || !["object", "array"].includes(sourceType)) {
            return false;
        }

        //get the parent state ref
        const { basePath, propName } = getParentAndPropName(path);
        const parent = getStateRef(basePath).value;

        if (!parent)
            return false;

        //copy the current value for the emit
        const oldValue = cloneValue(getStateByPath(path));

        //Unwrap the value if it's a proxy
        const rawValue = getRawValue(source);
        const rawValueIsComposite = isComposite(rawValue);

        //set the prop on the parent
        parent[propName] = rawValue;

        eventManager.emit(
            path,
            rawValueIsComposite
                ? createProxy<T>(rawValue, path)
                : rawValue,
            oldValue,
            "replace"
        );

        return true;
    }

    /**
     * Root level store get method
     * @param path
     * @returns
     */
    const get = <T = any>(path: string): T & ProxyObject => {
        const target = getStateByPath(path)

        if (isComposite(target)) {
            return createProxy<T>(target, path);
        }

        return target;
    };

    /**
     * Root level store set method
     * @param path
     * @param value
     * @returns
     */
    const set = <T = any>(path: string, value: T): boolean => {
        ///LOGGING
        report("state-set", "Set explicitly %s", [path]);
        ///END LOGGING

        const { basePath, propName } = getParentAndPropName(path);
        return setStateByPath(basePath, propName, value, true, true);
    };

    const keys = <T = any>(path: string): (string | number | Symbol)[] => {
        const keys: (string | number | Symbol)[] = [];

        const obj = get(path);

        for (const key in obj)
            keys.push(key);
        return keys;
    }

    /**
     * Root level store delete method
     * @param path
     * @returns
     */
    const deleteProperty = (path: string): boolean => {
        ///LOGGING
        report("state-set", "Delete explicitly %s", [path]);
        ///END LOGGING

        const { basePath, propName } = getParentAndPropName(path);

        return deleteStateByPath(basePath, propName);
    }

    return {
        get,
        set,
        delete: deleteProperty,
        keys,
        apply,
        applyIf,
        isRefMatch,
        replace,
        on: eventManager.addListener,
        off: eventManager.removeListener,
        state: createProxy<R>(state, "$")
    };
};
