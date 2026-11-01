import { report, getType } from '@punyts/core';
import { applyToState, applyToStateIf, replaceState } from './ApplyState.js';
import { createEventManager, EventManager, EventListenerFn } from './EventManager.js';
import { createPathIndex } from './PathIndex.js';
import { ProxyObject as ProxyObjectType, getRawType } from './Types.js';

const PATT_STATE_PATH = /^(?:(?:[0-z$\-_]+)(?:[.](?!$)|$))+$/;
const PATT_LEADING_DOTS = /^([.]+)(.*)/;

export interface LinkOptions {
    /** accept a target that does not exist yet, as long as its parent does */
    allowMissing?: boolean;
}

export interface Store<R> {
    get: <T = any>(path: string) => T & ProxyObjectType;
    set: <T = any>(path: string, value: Partial<T>) => boolean;
    delete: (path: string) => boolean;
    on: (path: string | string[], listener: EventListenerFn) => void;
    off: (path: string | string[], listener?: EventListenerFn) => void;
    keys: <T = any>(path: string) => (string | number | Symbol)[];
    apply: (path: string, source: any) => void;
    applyIf: (path: string, source: any) => void;
    isRefMatch: (path: string, source: any) => boolean;
    replace: (path: string, source: any) => void;
    link: (fromPath: string, toPath: string, options?: LinkOptions) => boolean;
    unlink: (fromPath: string) => boolean;
    protect: (path: string) => boolean;
    unprotect: (path: string) => boolean;
    state: R;
}

// Re-export ProxyObject from Types for backward compatibility
export type ProxyObject = ProxyObjectType;

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

// getRawType is now imported from Types.ts and re-exported
export { getRawType } from './Types.js';

const OBJECT_TAG = "[object Object]";

/**
 * True for an array or a generic object, a proxy of either included: the values the store walks into and wraps.
 * Runs on every read, so it compares the tag rather than building the type name (a proxy reports its target's tag)
 * @param value
 */
const isComposite = (value: any) => {
    return value !== null
        && typeof value === "object"
        && (Array.isArray(value) || Object.prototype.toString.call(value) === OBJECT_TAG);
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
    //alias path -> target path, both "$."-prefixed. Links are runtime structure of the store, never part of the state data;
    //the target is kept as given and resolved on every access, so an alias whose target is itself an alias follows it
    const links: Map<string, string> = new Map();
    //path -> the path with every link followed, for the paths read since the links last changed; every change to the link
    //map clears it, as one link can change what any path resolves to
    const resolved: Map<string, string> = new Map();
    const MAX_RESOLVED = 20_000;
    //path as read -> the segments of the path it resolves to, so a repeated read neither follows links nor splits again;
    //cleared with the resolved paths
    const segmentsRead: Map<string, readonly string[]> = new Map();
    const forgetResolved = (): void => {
        resolved.clear();
        segmentsRead.clear();
    }
    //each alias filed under its target as given, so a change finds the aliases at, below or above it without visiting the rest
    const linkTargets = createPathIndex<string>();
    //the order aliases were made, which is the order their listeners hear a change in; a re-point keeps the place
    const linkOrder: Map<string, number> = new Map();
    let nextLinkOrder = 0;

    const byLinkOrder = (a: string, b: string): number => linkOrder.get(a)! - linkOrder.get(b)!;

    /** Makes or re-points the alias in the link map and its indexes */
    const setLink = (from: string, to: string): void => {
        const previous = links.get(from);
        if (previous !== undefined) {
            linkTargets.remove(previous, from);
        }
        else {
            linkOrder.set(from, nextLinkOrder++);
        }
        links.set(from, to);
        forgetResolved();
        linkTargets.add(to, from);
    }

    /** Removes the alias from the link map and its indexes; false when it is not an alias */
    const removeLink = (from: string): boolean => {
        const previous = links.get(from);
        if (previous === undefined) {
            return false;
        }
        links.delete(from);
        forgetResolved();
        linkOrder.delete(from);
        linkTargets.remove(previous, from);
        return true;
    }

    /**
     * The aliases whose target, as given, is the path, lies below it or lies above it, each with that target, in the
     * order the aliases were made
     */
    const linksAround = (path: string): [string, string][] => {
        const found = new Set(linkTargets.atOrBelow(path));
        for (const [, aliases] of linkTargets.above(path)) {
            for (const alias of aliases) found.add(alias);
        }
        return [...found].sort(byLinkOrder).map((alias) => [alias, links.get(alias)!]);
    }
    //a proxy this store hands out answers this key with the raw object it wraps; a proxy of another store does not know it
    const RAW_TARGET = Symbol("raw target");
    //the proxy handler of each base path: a proxy's behaviour depends only on its base path, so the handler and its traps
    //are made once per path rather than once per read
    const proxyHandlers: Map<string, ProxyHandler<any>> = new Map();
    const MAX_HANDLERS = 20_000;
    //read-only paths, "$."-prefixed; a write at or below one is refused
    const protectedPaths: Set<string> = new Set();

    const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/;
    /**
     * True when propName is an index of the array base (as opposed to "length" or a named prop)
     * @param base
     * @param propName
     */
    const isArrayIndex = (base: any, propName: string) => {
        return Array.isArray(base) && ARRAY_INDEX.test(propName);
    }

    /**
     * Prefixes a root-relative path with "$." so it splits into the right parent and prop name
     * and matches the $.-keyed listeners ("users" -> "$.users"; "$" and "$.x" are unchanged)
     * @param path
     */
    const normalizePath = (path: string) => {
        return path === "$" || path.startsWith("$.")
            ? path
            : `$.${path}`;
    }

    /**
     * Follows one link: a path at or below an alias becomes the same path below the alias target.
     * The shortest alias prefix is followed. Returns undefined when no alias is in the path.
     * @param path - a "$."-prefixed path
     * @param linkMap - the links to follow
     */
    const followLink = (path: string, linkMap: Map<string, string>): string | undefined => {
        let dot = path.indexOf(".");
        for (;;) {
            const candidate = dot === -1 ? path : path.slice(0, dot);
            if (linkMap.has(candidate)) {
                return linkMap.get(candidate)! + path.slice(candidate.length);
            }
            if (dot === -1) {
                return undefined;
            }
            dot = path.indexOf(".", dot + 1);
        }
    }

    /**
     * Follows the links from path until no alias is left in it.
     * Returns undefined when the links loop.
     * @param path - a "$."-prefixed path
     * @param linkMap - the links to follow, the store links by default
     */
    const resolveLinks = (path: string, linkMap: Map<string, string> = links): string | undefined => {
        if (linkMap.size === 0) {
            return path;
        }

        let current = path;
        for (let hops = 0; hops <= linkMap.size; hops++) {
            const next = followLink(current, linkMap);
            if (next === undefined) {
                return current;
            }
            current = next;
        }

        return undefined;
    }

    /**
     * Every path whose resolved path changes when the alias is re-pointed, as the roots of the trees to notify:
     * the alias itself, each alias whose target is at or below a root, and each path below an alias whose target is
     * above a root (the alias path followed by the rest of the root path).
     * Each root found is looked up in turn, so an alias whose target leads through another alias is reached through
     * that alias's root, which covers any depth and arrangement of aliases.
     * @param alias - the re-pointed alias path
     */
    const repointedPaths = (alias: string): string[] => {
        const roots = [alias];
        const seen = new Set<string>(roots);
        for (let i = 0; i < roots.length; i++) {
            const root = roots[i]!;
            for (const [from, target] of linksAround(root)) {
                const reached = target === root || target.startsWith(`${root}.`)
                    ? from
                    : `${from}${root.slice(target.length)}`;
                if (!seen.has(reached)) {
                    seen.add(reached);
                    roots.push(reached);
                }
            }
        }
        return roots;
    }

    /**
     * True when path is a protected path or lies below one
     * @param path - a "$."-prefixed path
     */
    const isProtected = (path: string): boolean => {
        if (protectedPaths.size === 0) {
            return false;
        }
        for (let dot = path.indexOf("."); ; dot = path.indexOf(".", dot + 1)) {
            if (protectedPaths.has(dot === -1 ? path : path.slice(0, dot))) {
                return true;
            }
            if (dot === -1) {
                return false;
            }
        }
    }

    /**
     * The path with every link followed; a path that cannot be resolved is returned as it is.
     * Remembered until the links change, as the same paths are read over and over between link changes
     * @param path - a "$."-prefixed path
     */
    const resolvePath = (path: string): string => {
        if (links.size === 0) {
            return path;
        }
        const known = resolved.get(path);
        if (known !== undefined) {
            return known;
        }
        const next = resolveLinks(path) ?? path;
        if (resolved.size >= MAX_RESOLVED) {
            resolved.clear();
        }
        resolved.set(path, next);
        return next;
    }

    /**
     * The value at the segments below a value, or undefined where a step is missing
     * @param value
     * @param segments
     */
    const pick = (value: any, segments: readonly string[]): any => {
        let current = value;
        for (const segment of segments) {
            if (current === null || typeof current !== "object") {
                return undefined;
            }
            current = current[segment];
        }
        return current;
    }

    /**
     * Emits the change at path, then tells the listeners of every alias that shows the changed value.
     * A change at or above the alias target reaches the alias path and everything listening below it with the alias
     * path in the event; a change inside the target reaches the mapped path below the alias.
     * A child change at the target ("insert-child", "update-child", "delete-child") reaches the alias path only, as it
     * reaches only the target path's own listeners. Changes to the children of a path above the target leave the
     * target alone and are not passed on.
     * An alias path is itself a path other aliases can lead to, so each alias event is passed on the same way, which
     * reaches listeners below an alias that leads to another alias. Every event is emitted once.
     * @param path - the resolved path that changed
     */
    const emitChange = (path: string, value: any, oldValue: any, action: string) => {
        eventManager.emit(path, value, oldValue, action);

        if (links.size === 0) {
            return;
        }

        const emitted = new Set<string>();
        //only the targets as given are looked up: a target that leads through another alias is reached when the change
        //is passed on to that alias's path
        const spread = (changed: string): void => {
            for (const [from, target] of linksAround(changed)) {
                //a child of the target was added, changed in place or removed: the target keeps its value, so the alias
                //path hears the event as the target path does, and the child's own event reaches the path below the alias
                if (changed === target && action.endsWith("-child")) {
                    if (!emitted.has(from)) {
                        emitted.add(from);
                        eventManager.emit(from, value, oldValue, action);
                        spread(from);
                    }
                }
                else if (changed === target || (target.startsWith(`${changed}.`) && !action.endsWith("-child"))) {
                    if (!emitted.has(`tree:${from}`)) {
                        emitted.add(`tree:${from}`);
                        //a change above the target hands the alias what it shows: the values at the target's place in the
                        //changed values, not the whole object of the path that changed
                        const rest = changed === target ? [] : target.slice(changed.length + 1).split(".");
                        eventManager.emitTree(from, pick(value, rest), pick(oldValue, rest), action);
                        spread(from);
                    }
                }
                else if (changed.startsWith(`${target}.`)) {
                    const mapped = `${from}${changed.slice(target.length)}`;
                    if (!emitted.has(mapped)) {
                        emitted.add(mapped);
                        eventManager.emit(mapped, value, oldValue, action);
                        spread(mapped);
                    }
                }
            }
        }
        spread(path);
    }

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
            //proxies from this store unwrap to their actual target; resolving by path is wrong mid-reorder
            //(e.g. reverse/sort/shift), when the path may already hold a different element
            const raw = value[RAW_TARGET];
            if (raw !== undefined) {
                return raw;
            }
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

        //follow links so every read lands on the target, then split without the leading "$."
        let segments = segmentsRead.get(path);
        if (segments === undefined) {
            const target = links.size > 0 ? resolvePath(normalizePath(path)) : path;
            segments = (target.startsWith('$.') ? target.slice(2) : target).split('.');
            if (segmentsRead.size >= MAX_RESOLVED) segmentsRead.clear();
            segmentsRead.set(path, segments);
        }

        // Traverse the state object to the second-to-last segment
        let current: any = state;
        let parent: any = null;
        let index: string | null = null;
        const len = segments.length;

        for (let i = 0; i < len; i++) {
            const segment = segments[i];

            //one lookup per segment; "in" only tells a missing key from a key holding undefined
            const next = current !== null && typeof current === "object" ? current[segment] : undefined;
            if (next !== undefined || (current !== null && typeof current === "object" && segment in current)) {
                parent = current;
                index = segment;
                current = next;
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

        let fullPath = propName
            ? `${basePath}.${propName}`
            : basePath;

        //a protected path refuses writes, at the path given and at the target an alias leads to
        if (isProtected(fullPath)) {
            return false;
        }

        //a write at or below an alias lands on the target, and events are emitted for the target path
        if (links.size > 0) {
            const resolvedPath = resolvePath(fullPath);
            if (resolvedPath !== fullPath) {
                fullPath = resolvedPath;
                ({ basePath, propName } = getParentAndPropName(resolvedPath));
                if (isProtected(fullPath)) {
                    return false;
                }
            }
        }

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

        //setting an array index replaces the element reference, as on a plain array; merging would overwrite
        //the element in place, which corrupts arrays when Array methods (sort, reverse, shift, unshift) move elements
        const replacesArrayElement = overwrite && remove && isArrayIndex(base, propName);

        //when both the current and new values are objects, they need to be merged
        if (rawValueIsComposite && currentIsComposite && !replacesArrayElement) {
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
            emitChange(
                fullPath,
                rawValueIsComposite
                    ? createProxy<T>(rawValue, fullPath)
                    : rawValue,
                oldValue,
                hasProp ? "update" : "insert"
            );

            //if we are adding a new property to the basePath then we need to fire an event for that,
            //primitives included, otherwise a primitive push is invisible to a listener on the array path
            if (!hasProp) {
                emitChange(
                    basePath,
                    createProxy<T>(base, basePath),
                    undefined,
                    "insert-child"
                );
            }
            //an array element changed in place (sort, reverse, shift, splice...), so tell the array path too;
            //objects keep the no fan-out rule and only emit on the property path
            else if (isArrayIndex(base, propName)) {
                emitChange(
                    basePath,
                    createProxy<T>(base, basePath),
                    undefined,
                    "update-child"
                );
            }
        }

        return true;
    };

    /**
     * Deletes the property
     * @param basePath
     * @param propName
     * @param leaveHole - true for the proxy deleteProperty trap: an array index becomes a hole, as with a plain
     * `delete arr[i]`, because Array methods (shift, splice, pop) move elements and set length themselves;
     * false for store.delete, which removes the element at that index
     * @returns
     */
    const deleteStateByPath = (basePath: string, propName: string, leaveHole: boolean = false): boolean => {
        basePath = basePath.startsWith("$")
            ? basePath
            : `$.${basePath}`;

        let fullPath = propName
            ? `${basePath}.${propName}`
            : basePath;

        if (isProtected(fullPath)) {
            return false;
        }

        //deleting at or below an alias deletes on the target
        if (links.size > 0) {
            const resolvedPath = resolvePath(fullPath);
            if (resolvedPath !== fullPath) {
                fullPath = resolvedPath;
                ({ basePath, propName } = getParentAndPropName(resolvedPath));
                if (isProtected(fullPath)) {
                    return false;
                }
            }
        }

        const stateRef = getStateRef(fullPath);
        if (!stateRef.found)
            return false;

        const oldValue = cloneValue(stateRef.parent[stateRef.index as string]);

        //for an explicit delete of an array element, splice at the index (indexOf picks the wrong slot for duplicates)
        if (Array.isArray(stateRef.parent) && !leaveHole) {
            stateRef.parent.splice(Number(stateRef.index), 1);
        }
        //otherwise we can delete it outright
        else {
            delete stateRef.parent[stateRef.index as string];
        }

        emitChange(
            fullPath,
            undefined,
            oldValue,
            "delete"
        );

        //emit an event for the base path since it is changing as well
        if (basePath !== fullPath) {
            emitChange(
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
        let handler = proxyHandlers.get(basePath);
        if (!handler) {
            if (proxyHandlers.size >= MAX_HANDLERS) {
                proxyHandlers.clear();
            }
            handler = createProxyHandler<T>(basePath);
            proxyHandlers.set(basePath, handler);
        }
        return new Proxy(target, handler);
    };

    /**
     * The traps of a proxy at base path
     * @param basePath
     */
    const createProxyHandler = <T>(basePath: string): ProxyHandler<any> => {
        return {
            get(obj, propName) {
                if (propName === RAW_TARGET) {
                    return obj;
                }
                //we don't support symbols
                if (typeof propName !== 'string') {
                    return obj[propName];
                }

                //if the property is in the target then use that
                if (propName in obj) {
                    const value = obj[propName];
                    //for generic arrays and objects create a proxy (skips things like elements)
                    if (isComposite(value)) {
                        return createProxy<T>(value, `${basePath}.${propName}`);
                    }
                    return value;
                }
                //a property that is an alias shows the value of its target
                if (links.size > 0) {
                    const fullPath = `${basePath}.${propName}`;
                    const linked = getStateRef(fullPath);
                    if (linked.found) {
                        return isComposite(linked.value)
                            ? createProxy<T>(linked.value, fullPath)
                            : linked.value;
                    }
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

                if (links.size > 0 && getStateRef(`${basePath}.${propName}`).found) {
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

                //deleting a missing property (e.g. an array hole) succeeds, as with plain delete;
                //returning false would make Array methods throw from DeletePropertyOrThrow
                if (!(propName in obj)) {
                    return true;
                }

                //a protected path ignores the delete, as the set trap ignores a write
                if (isProtected(`${basePath}.${propName}`) || isProtected(resolvePath(`${basePath}.${propName}`))) {
                    return true;
                }

                return deleteStateByPath(basePath, propName, true);
            }
        };
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

        const { basePath, propName } = getParentAndPropName(normalizePath(path));
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

        const { basePath, propName } = getParentAndPropName(normalizePath(path));
        return setStateByPath(basePath, propName, source, true, false);
    }

    /**
     * Replaces the value at path with source, overwriting objects and arrays rather than applying the source props to target
     * @param path
     * @param source
     */
    const replace = <T = any>(path: string, source: any) => {
        //listeners are keyed by $.-prefixed paths, so normalize before splitting and emitting
        path = normalizePath(path);
        if (isProtected(path)) {
            return false;
        }
        path = resolvePath(path);
        if (isProtected(path)) {
            return false;
        }

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

        emitChange(
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
     * An event value for the resolved path: a composite value as a proxy, a primitive as it is, undefined when missing
     * @param path - a resolved "$."-prefixed path
     */
    const readEventValue = (path: string) => {
        const ref = getStateRef(path);
        return ref.found && isComposite(ref.value)
            ? createProxy(ref.value, path)
            : ref.value;
    }

    /**
     * Makes fromPath an alias of toPath: reads and writes at or below fromPath act on toPath, and changes at toPath
     * notify the listeners of fromPath. The alias is runtime structure, it is never part of the state data.
     * When fromPath already is an alias it is re-pointed to toPath: the listeners at and below it, and those on every
     * alias that resolves through it, are notified once with the "relink" action, and no listener is added or removed.
     * Returns false when the target does not exist (unless options.allowMissing is set and its parent exists), when the
     * target is the alias itself, inside it or above it, when the links would loop, or when fromPath holds data.
     * @param fromPath - the alias path
     * @param toPath - the path the alias stands for
     * @param options - allowMissing accepts a target that does not exist yet
     */
    const link = (fromPath: string, toPath: string, options?: LinkOptions): boolean => {
        if (typeof fromPath !== "string" || typeof toPath !== "string") {
            return false;
        }

        const from = normalizePath(fromPath);
        const to = normalizePath(toPath);

        if (from === "$" || !validatePath(from) || !validatePath(to)) {
            return false;
        }

        //an alias must not hide data in the state
        const repoint = links.has(from);
        if (!repoint && getStateRef(from).found) {
            return false;
        }

        //an alias whose chain returns to itself, or that holds or is held by its own target, would never settle
        //tried in the link map itself, put back at once, rather than in a copy of every link
        const previous = links.get(from);
        links.set(from, to);
        forgetResolved();
        const resolvedTarget = resolveLinks(to);
        if (previous === undefined) {
            links.delete(from);
            forgetResolved();
        }
        else {
            links.set(from, previous);
            forgetResolved();
        }
        if (
            resolvedTarget === undefined
            || resolvedTarget === from
            || resolvedTarget.startsWith(`${from}.`)
            || from.startsWith(`${resolvedTarget}.`)
        ) {
            return false;
        }

        if (options?.allowMissing) {
            //the parent of a missing target must exist and be able to hold it
            const parentPath = getParentAndPropName(resolvedTarget).basePath;
            if (!isComposite(getStateRef(parentPath).value)) {
                return false;
            }
        }
        else if (!getStateRef(resolvedTarget).found) {
            return false;
        }

        setLink(from, to);
        if (!repoint) {
            return true;
        }

        const aliases = repointedPaths(from);
        //what each alias showed is read with the old target back in the link map
        links.set(from, previous!);
        forgetResolved();
        const oldValues = aliases.map((alias) => readEventValue(resolvePath(alias)));
        links.set(from, to);
        forgetResolved();
        eventManager.emitTrees(
            aliases.map((alias, i) => ({
                path: alias,
                value: readEventValue(resolvePath(alias)),
                oldValue: oldValues[i]
            })),
            "relink"
        );

        return true;
    }

    /**
     * Makes the path read-only: a write at or below it, direct or through an alias, returns false and emits nothing.
     * Reads, links to the path and listeners are not affected. A write to a path above it is not refused.
     * Returns false when the path is not valid.
     * @param path
     */
    const protect = (path: string): boolean => {
        if (typeof path !== "string") {
            return false;
        }
        const protectedPath = normalizePath(path);
        if (!validatePath(protectedPath)) {
            return false;
        }
        protectedPaths.add(protectedPath);
        return true;
    }

    /**
     * Lifts the protection from the path. Returns false when the path was not protected.
     * @param path
     */
    const unprotect = (path: string): boolean => {
        return typeof path === "string" && protectedPaths.delete(normalizePath(path));
    }

    /**
     * Removes the alias at fromPath. Listeners stay registered; they just stop hearing the former target.
     * Returns false when fromPath is not an alias.
     * @param fromPath
     */
    const unlink = (fromPath: string): boolean => {
        return typeof fromPath === "string" && removeLink(normalizePath(fromPath));
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

        const { basePath, propName } = getParentAndPropName(normalizePath(path));
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

        const { basePath, propName } = getParentAndPropName(normalizePath(path));

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
        link,
        unlink,
        protect,
        unprotect,
        on: eventManager.addListener,
        off: eventManager.removeListener,
        state: createProxy<R>(state, "$")
    };
};
