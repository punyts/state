interface PathNode<T> {
    children: Map<string, PathNode<T>>;
    items: Set<T>;
}

/** Items filed under dotted paths, for the lookups the store and the event manager repeat on every write */
export interface PathIndex<T> {
    /** Files the item under the path */
    add: (path: string, item: T) => void;
    /** Takes the item off the path; a branch left empty is removed */
    remove: (path: string, item: T) => void;
    /** The items filed at the path itself */
    at: (path: string) => Set<T>;
    /** The items filed at the path or anywhere below it (a path that starts with it and a dot) */
    atOrBelow: (path: string) => T[];
    /** Each path strictly above the given one (its dotted prefixes) that has items, with them, shortest first */
    above: (path: string) => [string, Set<T>][];
}

const createNode = <T>(): PathNode<T> => ({ children: new Map(), items: new Set() });

/**
 * Creates a path index: a tree of path segments, so finding what is filed at, below or above a path costs the
 * length of the path and the number of matches, not the number of paths filed
 */
export const createPathIndex = <T>(): PathIndex<T> => {
    const root = createNode<T>();

    const add = (path: string, item: T): void => {
        let node = root;
        for (const segment of path.split(".")) {
            let child = node.children.get(segment);
            if (!child) {
                child = createNode<T>();
                node.children.set(segment, child);
            }
            node = child;
        }
        node.items.add(item);
    };

    const remove = (path: string, item: T): void => {
        const trail: [PathNode<T>, string][] = [];
        let node = root;
        for (const segment of path.split(".")) {
            const child = node.children.get(segment);
            if (!child) {
                return;
            }
            trail.push([node, segment]);
            node = child;
        }
        node.items.delete(item);
        //prune the branch from the leaf up while it holds nothing
        for (let i = trail.length - 1; i >= 0; i--) {
            const [parent, segment] = trail[i]!;
            const child = parent.children.get(segment)!;
            if (child.items.size > 0 || child.children.size > 0) {
                return;
            }
            parent.children.delete(segment);
        }
    };

    const find = (path: string): PathNode<T> | undefined => {
        let node: PathNode<T> | undefined = root;
        for (const segment of path.split(".")) {
            node = node.children.get(segment);
            if (!node) {
                return undefined;
            }
        }
        return node;
    };

    const at = (path: string): Set<T> => find(path)?.items ?? new Set();

    const atOrBelow = (path: string): T[] => {
        const node = find(path);
        if (!node) {
            return [];
        }
        const found: T[] = [];
        const stack: PathNode<T>[] = [node];
        while (stack.length > 0) {
            const next = stack.pop()!;
            for (const item of next.items) found.push(item);
            for (const child of next.children.values()) stack.push(child);
        }
        return found;
    };

    const above = (path: string): [string, Set<T>][] => {
        const found: [string, Set<T>][] = [];
        const segments = path.split(".");
        let node: PathNode<T> | undefined = root;
        let prefix = "";
        for (let i = 0; i < segments.length - 1; i++) {
            node = node.children.get(segments[i]!);
            if (!node) {
                break;
            }
            prefix = i === 0 ? segments[i]! : `${prefix}.${segments[i]}`;
            if (node.items.size > 0) found.push([prefix, node.items]);
        }
        return found;
    };

    return { add, remove, at, atOrBelow, above };
};
