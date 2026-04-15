import { report } from "@punyts/core";
import { getRawType, ProxyObject } from "./Types.js";

/**
 * Recursively applys the properties from source to target ONLY IF the target does not have the property
 * @param target
 * @param source
 */
export const applyToStateIf = <T extends object>(
    target: T,
    source: any
): void => {
    report("state-apply", "applyToStateIf invoked", { targetPath: (target as any)?.__path });
    return apply(target, source);
};

/**
 * Recursively applys the properties from source to target
 * @param target
 * @param source
 * @param path
 * @param visited
 */
export const applyToState = <T extends object>(
    target: T,
    source: any
): void => {
    report("state-apply", "applyToState invoked", { targetPath: (target as any)?.__path });
    return apply(target, source, true);
}

/**
 * Recursively applys the properties from source to target and removes any properties on target that aren't on source
 * @param target
 * @param source
 * @returns
 */
export const replaceState = <T extends object>(
    target: T,
    source: any
): void => {
    report("state-apply", "replaceState invoked", { targetPath: (target as any)?.__path });
    return apply(target, source, true, true);
}

/**
 * Recursively applys the properties from source to target and only overwrites existing properties if overwrite=true
 * @param target
 * @param source
 * @param overwrite
 * @param path
 * @param visited
 * @returns
 */
const apply = <T extends object>(
    target: T,
    source: any,
    overwrite: boolean = false,
    remove: boolean = false,
    path: string = "$",
    visited: WeakSet<object> = new WeakSet()
) => {
    report("state-apply-extended", "apply core", { path, overwrite, remove });
    const targetIsObject = ["object", "array"].includes(
        getRawType(target)
    );
    const sourceIsObject = ["object", "array"].includes(
        getRawType(source)
    );

    //we need to have a generic object or array for both the target and source to proceed
    if (!targetIsObject || !sourceIsObject) {
        return;
    }

    //see if these objects are the same
    if (target === source) { //explicitly
        return;
    }
    const targetProxy = (target as ProxyObject);
    if (targetProxy.__isProxy && targetProxy.__isRefMatch(source)) { //through the proxy
        return;
    }

    // Prevent circular references by checking if the object has already been visited
    if (visited.has(source)) {
        return;
    }
    visited.add(source);

    Object.keys(source).forEach((key) => {
        const childPath = `${path}.${key}`;
        const sourceValue = (source as any)[key];

        //set the property on the target if it does not exist
        if (!target.hasOwnProperty(key)) {
            target[key as keyof T] = sourceValue;
            return;
        }

        const targetValue = target[key as keyof T] as ProxyObject;

        const targetType = getRawType(targetValue);
        const sourceType = getRawType(sourceValue);

        //overwrite the target if the source is not the same type
        if (sourceType !== targetType) {
            if (overwrite) {
                target[key as keyof T] = sourceValue;
            }
            return;
        }

        //the target and source values must be a generic object or array (skip things like elements)
        if (["object", "array"].includes(targetType) && ["object", "array"].includes(sourceType)) {
            apply(
                targetValue as object,
                sourceValue as object,
                overwrite,
                remove,
                childPath,
                visited
            );
        }
        else if (sourceValue !== targetValue) {
            if (overwrite || !Object.prototype.hasOwnProperty.call(target, key)) {
                target[key as keyof T] = sourceValue;
            }
        }
    });

    //if we are removing then we need to clear out any props not on the source
    if (remove) {
        Object.keys(target).forEach((key: string) => {
            if (!source.hasOwnProperty(key) && target.hasOwnProperty(key)) {
                if (Array.isArray(target)) {
                    target.splice(parseInt(key), 1);
                }
                else {
                    delete target[key as keyof T];
                }
            }
        });
    }
}