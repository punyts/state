import { beforeEach, describe, expect, it } from 'vitest';
import { createStore, Store } from './Store.js';

interface Heard {
    path: string;
    action: string;
    origin: string | undefined;
}

describe('write origin', () => {
    let store: Store<any>;
    let heard: Heard[];

    const listen = (path: string) => {
        store.on(path, (eventPath, _value, _oldValue, action, origin) => {
            heard.push({ path: eventPath, action, origin });
        });
    };

    beforeEach(() => {
        store = createStore<any>({
            data: {
                totals: { month: 10, year: 120 },
                items: ['a', 'b'],
                rows: { r1: { name: 'one' } }
            },
            other: { month: 5 }
        });
        heard = [];
    });

    describe('tagged writes', () => {
        it('should tag the update of a set', () => {
            // Arrange
            listen('$.data.totals.month');

            // Act
            store.set('$.data.totals.month', 11, { origin: 'sync' });

            // Assert
            expect(heard).toEqual([{ path: '$.data.totals.month', action: 'update', origin: 'sync' }]);
        });

        it('should tag the insert and the insert-child when a set adds a key', () => {
            // Arrange
            listen('$.data.rows.r2');
            listen('$.data.rows');

            // Act
            store.set('$.data.rows.r2', { name: 'two' }, { origin: 'sync' });

            // Assert
            expect(heard).toEqual([
                { path: '$.data.rows.r2', action: 'insert', origin: 'sync' },
                { path: '$.data.rows', action: 'insert-child', origin: 'sync' }
            ]);
        });

        it('should tag the update-child when a set writes an array index', () => {
            // Arrange
            listen('$.data.items');

            // Act
            store.set('$.data.items.0', 'z', { origin: 'sync' });

            // Assert
            expect(heard).toEqual([{ path: '$.data.items', action: 'update-child', origin: 'sync' }]);
        });

        it('should tag the replace', () => {
            // Arrange
            listen('$.data.totals');

            // Act
            store.replace('$.data.totals', { month: 1 }, { origin: 'sync' });

            // Assert
            expect(heard).toEqual([{ path: '$.data.totals', action: 'replace', origin: 'sync' }]);
        });

        it('should tag every per-key event of an apply', () => {
            // Arrange
            listen('$.data.totals.$every');

            // Act
            store.apply('$.data.totals', { month: 12, year: 130 }, { origin: 'sync' });

            // Assert
            expect(heard).toEqual([
                { path: '$.data.totals.month', action: 'update', origin: 'sync' },
                { path: '$.data.totals.year', action: 'update', origin: 'sync' }
            ]);
        });

        it('should tag the events of an applyIf', () => {
            // Arrange
            listen('$.data.totals.$every');

            // Act
            store.applyIf('$.data.totals', { month: 99, week: 3 }, { origin: 'sync' });

            // Assert
            expect(heard).toEqual([{ path: '$.data.totals.week', action: 'insert', origin: 'sync' }]);
            expect(store.get('$.data.totals.month')).toBe(10);
        });

        it('should tag the delete and the delete-child', () => {
            // Arrange
            listen('$.data.rows.r1');
            listen('$.data.rows');

            // Act
            store.delete('$.data.rows.r1', { origin: 'sync' });

            // Assert
            expect(heard).toEqual([
                { path: '$.data.rows.r1', action: 'delete', origin: 'sync' },
                { path: '$.data.rows', action: 'delete-child', origin: 'sync' }
            ]);
        });

        it('should tag the relink when an alias is re-pointed', () => {
            // Arrange
            store.link('$.view', '$.data.totals');
            listen('$.view.month');

            // Act
            store.link('$.view', '$.other', { origin: 'sync' });

            // Assert
            expect(heard).toEqual([{ path: '$.view', action: 'relink', origin: 'sync' }]);
        });
    });

    describe('untagged writes', () => {
        it('should carry no origin', () => {
            // Arrange
            listen('$.data.totals.$every');
            listen('$.data.rows');

            // Act
            store.set('$.data.totals.month', 11);
            store.apply('$.data.totals', { year: 1 });
            store.delete('$.data.rows.r1');
            store.state.data.totals.month = 13;

            // Assert
            expect(heard.map((event) => event.origin)).toEqual([undefined, undefined, undefined, undefined]);
        });

        it('should carry no origin after a tagged write', () => {
            // Arrange
            listen('$.data.totals.month');
            store.set('$.data.totals.month', 11, { origin: 'sync' });

            // Act
            store.set('$.data.totals.month', 12);

            // Assert
            expect(heard.map((event) => event.origin)).toEqual(['sync', undefined]);
        });

        it('should carry no origin after a tagged write whose listener threw', () => {
            // Arrange
            store.on('$.data.totals.month', () => { throw new Error('listener failed'); });
            store.set('$.data.totals.month', 11, { origin: 'sync' });
            listen('$.data.totals.year');

            // Act
            store.set('$.data.totals.year', 1);

            // Assert
            expect(heard).toEqual([{ path: '$.data.totals.year', action: 'update', origin: undefined }]);
        });
    });

    describe('aliases', () => {
        it('should report the target path with the tag when a tagged write goes through an alias', () => {
            // Arrange
            store.link('$.view', '$.data.totals');
            listen('$.data.totals.month');
            listen('$.view.month');

            // Act
            store.set('$.view.month', 11, { origin: 'sync' });

            // Assert
            expect(heard).toEqual([
                { path: '$.data.totals.month', action: 'update', origin: 'sync' },
                { path: '$.view.month', action: 'update', origin: 'sync' }
            ]);
        });

        it('should pass the tag to the alias listeners when a tagged write is above the target', () => {
            // Arrange
            store.link('$.month', '$.data.totals.month');
            listen('$.month');

            // Act
            store.replace('$.data.totals', { month: 1, year: 2 }, { origin: 'sync' });

            // Assert
            expect(heard).toEqual([{ path: '$.month', action: 'replace', origin: 'sync' }]);
        });
    });

    describe('listener writes', () => {
        it('should leave a write a listener makes during a tagged write untagged', () => {
            // Arrange
            store.on('$.data.totals.month', (_path, value) => {
                store.set('$.data.totals.year', value * 12);
            });
            listen('$.data.totals.year');

            // Act
            store.set('$.data.totals.month', 11, { origin: 'sync' });

            // Assert
            expect(heard).toEqual([{ path: '$.data.totals.year', action: 'update', origin: undefined }]);
            expect(store.get('$.data.totals.year')).toBe(132);
        });

        it('should keep the rest of a tagged apply tagged after a listener wrote', () => {
            // Arrange
            store.on('$.data.totals.month', () => {
                store.set('$.other.month', 0);
            });
            listen('$.data.totals.year');

            // Act
            store.apply('$.data.totals', { month: 12, year: 130 }, { origin: 'sync' });

            // Assert
            expect(heard).toEqual([{ path: '$.data.totals.year', action: 'update', origin: 'sync' }]);
        });

        it('should keep the own origin of a tagged listener write', () => {
            // Arrange
            store.on('$.data.totals.month', () => {
                store.set('$.other.month', 0, { origin: 'derived' });
            });
            listen('$.other.month');

            // Act
            store.set('$.data.totals.month', 11, { origin: 'sync' });

            // Assert
            expect(heard).toEqual([{ path: '$.other.month', action: 'update', origin: 'derived' }]);
        });
    });
});
