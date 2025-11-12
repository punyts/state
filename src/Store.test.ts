import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, getRawType } from './Store.js';

describe('Store', () => {
    let store: ReturnType<typeof createStore>;

    beforeEach(() => {
        store = createStore<any>({
            user: {
                name: 'John Doe',
                age: 30,
                address: {
                    city: 'New York',
                    zip: '10001',
                },
            },
            items: [1, 2, 3],
            myFn: () => true
        });
    });

    describe('get', () => {
        it('should retrieve a value by path', () => {
            const name = store.get('$.user.name');
            expect(name).toBe('John Doe');
        });

        it('should retrieve nested objects as proxies', () => {
            const user = store.get('$.user');
            expect(user).toHaveProperty('__isProxy', true);
            expect(user?.name).toBe('John Doe');
        });

        it('should return undefined for non-existent paths', () => {
            const value = store.get('$.nonExistent');
            expect(value).toBeUndefined();
        });
    });

    describe('set', () => {
        it('should set a value by path', () => {
            const success = store.set('$.user.name', 'Jane Doe');
            expect(success).toBe(true);
            expect(store.get('$.user.name')).toBe('Jane Doe');
        });

        it('should add new properties to objects', () => {
            const success = store.set('$.user.email', 'jane.doe@example.com');
            expect(success).toBe(true);
            expect(store.get('$.user.email')).toBe('jane.doe@example.com');
        });

        it('should return false if the base path does not exist', () => {
            const success = store.set('$.nonExistent.property', 'value');
            expect(success).toBe(false);
        });

        it('should replace the contents if a set', () => {
            const user = {
                name: 'Jim Doe',
                age: 50,
            };

            const success = store.set("$.user", user);
            expect(success).toBe(true);

            //since the user already exists, the props are applied so not a ref match
            expect(store.get("$.user").__isRefMatch(user)).toBe(false);

            expect(store.get("$.user")).toEqual({
                name: 'Jim Doe',
                age: 50,
            });
        });
    });

    describe('apply', () => {
        it('should merge using the proxy', () => {
            const user = store.get("$.user");
            user.__apply({ name: 'Jim Doe' });
            expect(store.get('$.user.name')).toBe('Jim Doe');
        });
    });

    describe('applyIf', () => {
        it('should only apply properties that do not exist', () => {
            store.applyIf('$.user', { age: 40, gender: 'female' });
            expect(store.get('$.user.age')).toBe(30); // Existing property remains unchanged
            expect(store.get('$.user.gender')).toBe('female'); // New property is added
        });

        it('should only apply properties that do not exist using the proxy', () => {
            const user = store.get("$.user");
            user.__applyIf({ name: 'Jim Doe', phone: '555-5555' });
            expect(store.get('$.user.name')).toBe('John Doe');
            expect(store.get('$.user.phone')).toBe('555-5555');
        });
    });

    describe('event listeners', () => {
        it('should trigger listeners on property change', () => {
            const listener = vi.fn();
            store.on('$.user.name', listener);

            store.set('$.user.name', 'Jane Doe');
            expect(listener).toHaveBeenCalledWith('$.user.name', 'Jane Doe', 'John Doe', "update");
        });

        it('should trigger listeners for wildcard paths', () => {
            const listener = vi.fn();
            store.on('$.user.address.$all', listener);

            store.set('$.user.address.city', 'Los Angeles');
            expect(listener).toHaveBeenCalledWith('$.user.address.city', 'Los Angeles', 'New York', "update");
        });

        it('should remove listeners', () => {
            const listener = vi.fn();
            store.on('$.user.name', listener);
            store.off('$.user.name', listener);

            store.set('$.user.name', 'Jane Doe');
            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe('event listeners proxy', () => {
        it('should trigger listeners on property change', () => {
            const listener = vi.fn();
            const user = store.get("$.user");
            user.__on(".name", listener);
            user.name = 'Jane Doe';
            expect(listener).toHaveBeenCalledWith('$.user.name', 'Jane Doe', 'John Doe', "update");
        });

        it('should trigger listeners for wildcard paths', () => {
            const listener = vi.fn();
            const user = store.get("$.user");
            user.__on(".address.$all", listener);
            user.address.city = 'Los Angeles';
            expect(listener).toHaveBeenCalledWith('$.user.address.city', 'Los Angeles', 'New York', "update");
        });

        it('should add listeners without a path fragment', () => {
            const listener = vi.fn();
            const user = store.get("$.user");
            user.__on(".", listener);
            store.set("$.user", {});
            expect(listener).toHaveBeenNthCalledWith(1, "$.user", undefined, "John Doe", "delete-child");
            expect(listener).toHaveBeenNthCalledWith(2, "$.user", undefined, 30, "delete-child");
            expect(listener).toHaveBeenNthCalledWith(3, "$.user", undefined, { "city": "New York", "zip": "10001" }, "delete-child");
            expect(listener).toHaveBeenNthCalledWith(4, "$.user", {}, { "address": { "city": "New York", "zip": "10001" }, "age": 30, "name": "John Doe" }, "update");
            user.__off(".", listener);
            store.set("$.user", user);
            expect(listener).toHaveBeenCalledTimes(4);
        });

        it('should remove listeners', () => {
            const listener = vi.fn();
            const user = store.get("$.user");
            user.__on('.name', listener);
            user.__off('.name', listener);
            user.name = 'Jane Doe';
            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe('isRefMatch', () => {
        it('should check if a proxy is a ref match', () => {
            const user = store.get("$.user");
            const isMatch1 = store.isRefMatch("$.user", user);
            const isMatch2 = store.isRefMatch("$.items", user);
            expect(isMatch1).toBe(true);
            expect(isMatch2).toBe(false);
        });

        it('should check if a proxy is a ref match from the proxy', () => {
            const user = store.get("$.user");
            const isMatch1 = user.__isRefMatch(store.get("$.user"));
            const isMatch2 = user.__isRefMatch(store.get("$.items"));
            expect(isMatch1).toBe(true);
            expect(isMatch2).toBe(false);
        });

        it('should handle non-object source values', () => {
            const user = store.get("$.user");
            const isMatch = user.__isRefMatch("non-object");
            expect(isMatch).toBe(false);
        })
    });

    describe('proxy behavior', () => {
        it('should allow setting properties through proxies', () => {
            const user = store.get('$.user');
            if (user) {
                user.name = 'Jane Doe';
            }
            expect(store.get('$.user.name')).toBe('Jane Doe');
        });

        it('should allow adding properties through proxies', () => {
            const user = store.get('$.user');
            if (user) {
                user.gender = 'female';
            }
            expect(store.get('$.user.gender')).toBe('female');
        });

        it('should trigger events when setting properties through proxies', () => {
            const listener = vi.fn();
            store.on('$.user.name', listener);

            const user = store.get('$.user');
            if (user) {
                user.name = 'Jane Doe';
            }
            expect(listener).toHaveBeenCalledWith('$.user.name', 'Jane Doe', 'John Doe', "update");
        });
    });

    describe('getRawType', () => {
        it('should return the type of a proxied value', () => {
            const myFn = store.get("$.myFn");
            const myFnType = getRawType(myFn);

            expect(myFnType).toBe("function");
        });

        it('should return the type of a non-proxied value', () => {
            const myFn = () => true;
            const myFnType = getRawType(myFn);

            expect(myFnType).toBe("function");
        });

        it('should return the type of a undefined value', () => {
            const myType = getRawType(undefined);

            expect(myType).toBe("undefined");
        });
    });

    describe('edge cases', () => {
        it('should handle setting non-object values on objects', () => {
            const success = store.set('$.user', 'Not an object');
            expect(success).toBe(true);
            expect(store.get('$.user')).toBe('Not an object');
        });

        it('should handle setting values on arrays', () => {
            const success = store.set('$.items.1', 42);
            expect(success).toBe(true);
            expect(store.get('$.items.1')).toBe(42);
        });

        it('should handle applying state if to arrays', () => {
            store.applyIf('$.items', [7, 8, 9]);
            expect(store.get('$.items')).toEqual([1, 2, 3]); // Existing array remains unchanged
        });

        it('should throw error when missing or non-string path when getting', () => {
            let error1: any;
            let error2: any;
            try {
                const value = store.get(null as unknown as string);
            }
            catch (err) {
                error1 = err;
            }
            try {
                const value = store.get({} as unknown as string);
            }
            catch (err) {
                error2 = err;
            }
            expect(error1).not.toBeUndefined();
            expect(error2).not.toBeUndefined();
        });

        it('should handle missing the base object when setting', () => {
            const success = store.set("$.missing.prop", "test");
            expect(success).toBeFalsy();
        });

        it('should handle a non-object base object when setting', () => {
            const success = store.set("$.user.name.prop", "test");
            expect(success).toBeFalsy();
        });

        it('should handle getting itself as a proxy when setting', () => {
            const user = store.get("$.user");
            const success = store.set("$.user", user);
            expect(success).toBeTruthy();
        });

        it("it shoud throw an error if we try to set the root to a non-object", () => {
            let error: any;
            try {
                store.set("$", "test");
            }
            catch (err) {
                error = err;
            }
            expect(error).not.toBeUndefined();
        });

        it('it should throw error when setting non-string prop names through the proxy', () => {
            const user = store.get("$.user");
            let error: any;
            try {
                user[Symbol("test")] = "";
            }
            catch (err) {
                error = err;
            }
            expect(error).not.toBeUndefined();
        });

        it('should handle getting paths without the leading $.', () => {
            const user = store.get("user");
            expect(user).toEqual(store.get("$.user"));
        });

        it('should handle setting paths without the leading $.', () => {
            store.set("user.name", "Jim Doe")
            expect(store.get("$.user.name")).toEqual("Jim Doe");
        });
    });
});

describe('Store - Circular References', () => {
    let store: ReturnType<typeof createStore>;

    beforeEach(() => {
        store = createStore();
    });

    it('should handle circular references in the state', () => {
        // Create an object with a circular reference
        const circularObject: any = {
            name: 'Circular Object',
        };
        circularObject.self = circularObject; // Circular reference

        // Set the circular object in the store
        const success = store.set('$.circular', circularObject);
        expect(success).toBe(true);

        // Retrieve the object and verify the circular reference
        const retrievedObject = store.get('$.circular');
        expect(retrievedObject).toBeDefined();
        expect(retrievedObject?.name).toBe('Circular Object');
        expect(retrievedObject.__isRefMatch(retrievedObject.self)).toBe(true); // Circular reference should be preserved

        // Modify a property in the circular reference and verify it propagates
        if (retrievedObject) {
            retrievedObject.name = 'Updated Circular Object';
        }
        expect(store.get('$.circular.name')).toBe('Updated Circular Object');
        expect(store.get('$.circular.self.name')).toBe('Updated Circular Object');
    });

    it('should not break when circular references are part of nested objects', () => {
        // Create a nested object with a circular reference
        const parentObject: any = {
            child: {
                name: 'Child Object',
            },
        };
        parentObject.child.parent = parentObject; // Circular reference

        // Set the nested object in the store
        const success = store.set('$.nested', parentObject);
        expect(success).toBe(true);

        // Retrieve the object and verify the circular reference
        const retrievedObject = store.get('$.nested');
        expect(retrievedObject).toBeDefined();
        expect(retrievedObject?.child.name).toBe('Child Object');
        expect(retrievedObject.__isRefMatch(retrievedObject?.child.parent)).toBe(true); // Circular reference should be preserved

        // Modify a property in the nested circular reference and verify it propagates
        if (retrievedObject) {
            retrievedObject.child.name = 'Updated Child Object';
        }
        expect(store.get('$.nested.child.name')).toBe('Updated Child Object');
        expect(store.get('$.nested.child.parent.child.name')).toBe('Updated Child Object');
    });
});