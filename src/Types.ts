import { getType } from '@punyts/core';
import { EventListenerFn } from './EventManager.js';

export type ProxyObject = {
    readonly __on: (path: string | string[], listener: EventListenerFn) => void;
    readonly __off: (path: string | string[], listener?: EventListenerFn) => void;
    readonly __keys: (string | number | Symbol)[];
    readonly __isProxy: boolean;
    readonly __type: string;
    readonly __path: string;
    readonly __get: <T>(path: string) => T & ProxyObject;
    readonly __set: <T = any>(path: string, value: Partial<T>) => boolean;
    readonly __delete: (path: string) => boolean;
    readonly __apply: (path: string, source: any) => void;
    readonly __applyIf: (path: string, source: any) => void;
    readonly __replace: (path: string, source: any) => void;
    readonly __isRefMatch: (source: any) => boolean;
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
};
