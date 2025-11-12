import { describe, expect, it } from 'vitest';
import { applyToState, applyToStateIf } from './ApplyState.js';

describe('ApplyState Utility Functions', () => {
    describe('applyToState', () => {
        it('should apply properties from source to target', () => {
            const target = { a: 1 };
            const source = { b: 2 };
            applyToState(target, source);
            expect(target).toEqual({ a: 1, b: 2 });
        });

        it('should overwrite existing properties in target', () => {
            const target = { a: 1 };
            const source = { a: 2 };
            applyToState(target, source);
            expect(target).toEqual({ a: 2 });
        });

        it('should handle deep objects', () => {
            const target = { a: { b: 1 } };
            const source = { a: { c: 2 } };
            applyToState(target, source);
            expect(target).toEqual({ a: { b: 1, c: 2 } });
        });

        it('should handle arrays', () => {
            const target = { a: [1, 2] };
            const source = { a: [3, 4] };
            applyToState(target, source);
            expect(target).toEqual({ a: [3, 4] });
        });

        it('should handle circular references: 1', () => {
            const target: any = { a: {} };
            const source: any = { a: {} }
            source.a.self = source;
            target.a.self = {};
            applyToState(target, source);
            expect(target.a.self.a).toBeUndefined();
        });

        it('should not apply properties if target and source are not objects or arrays', () => {
            const target = 1 as any;
            const source = { a: 2 };
            applyToState(target, source);
            expect(target).toBe(1);
        });

        it('should handle mismatched types by overwriting', () => {
            const target = { a: { b: 1 } };
            const source = { a: [1, 2, 3] };
            applyToState(target, source);
            expect(target).toEqual({ a: [1, 2, 3] });
        });
    });

    describe('applyToStateIf', () => {
        it('should apply properties only if they do not exist in target', () => {
            const target = { a: 1 };
            const source = { a: 2, b: 3 };
            applyToStateIf(target, source);
            expect(target).toEqual({ a: 1, b: 3 });
        });

        it('should handle deep objects', () => {
            const target = { a: { b: 1 } };
            const source = { a: { c: 2 } };
            applyToStateIf(target, source);
            expect(target).toEqual({ a: { b: 1, c: 2 } });
        });

        it('should handle arrays', () => {
            const target = { a: [1, 2] };
            const source = { a: [3, 4] };
            applyToStateIf(target, source);
            expect(target).toEqual({ a: [1, 2] });
        });

        it('should handle circular references: 2', () => {
            const target: any = { a: {} };
            const source: any = { a: {} }
            source.a.self = source;
            target.a.self = {};
            applyToStateIf(target, source);
            expect(target.a.self.a).toBeUndefined();
        });

        it('should not overwrite existing properties in target', () => {
            const target = { a: 1 };
            const source = { a: 2 };
            applyToStateIf(target, source);
            expect(target).toEqual({ a: 1 });
        });

        it('should handle mismatched types by skipping', () => {
            const target = { a: { b: 1 } };
            const source = { a: [1, 2, 3] };
            applyToStateIf(target, source);
            expect(target).toEqual({ a: { b: 1 } });
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty target and source', () => {
            const target = {};
            const source = {};
            applyToState(target, source);
            expect(target).toEqual({});
        });

        it('should handle null or undefined target', () => {
            const target = null as any;
            const source = { a: 1 };
            applyToState(target, source);
            expect(target).toBeNull();
        });

        it('should handle null or undefined source', () => {
            const target = { a: 1 };
            const source = null as any;
            applyToState(target, source);
            expect(target).toEqual({ a: 1 });
        });

        it('should handle deeply nested objects', () => {
            const target = { a: { b: { c: 1 } } };
            const source = { a: { b: { d: 2 } } };
            applyToState(target, source);
            expect(target).toEqual({ a: { b: { c: 1, d: 2 } } });
        });

        it('should handle deeply nested arrays', () => {
            const target = { a: [[1, 2]] };
            const source = { a: [[3, 4]] };
            applyToState(target, source);
            expect(target).toEqual({ a: [[3, 4]] });
        });

        it('should handle the target and source being the same', () => {
            const target = { a: [[1, 2]] };
            const source = target;
            applyToState(target, source);
            expect(target).toEqual(source);
        });

        it('should handle target proxy with source as ref', () => {
            const target = { __isProxy: true, __isRefMatch: (source: any) => true, __type: "object" };
            const source = { a: { b: { d: 2 } } };
            applyToState(target, source);
            //should not update since it's a ref match
            expect(target).toEqual({ "__isProxy": true, "__isRefMatch": target.__isRefMatch, __type: "object" });
        })
    });
});