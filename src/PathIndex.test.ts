import { describe, expect, it } from "vitest";
import { createPathIndex } from "./PathIndex.js";

describe("createPathIndex", () => {
    describe("atOrBelow", () => {
        it("should find the items at the path and below it, not beside it", () => {
            // Arrange
            const index = createPathIndex<string>();
            index.add("$.a", "a");
            index.add("$.a.b", "ab");
            index.add("$.a.b.c", "abc");
            index.add("$.ab", "beside");
            index.add("$.x", "x");

            // Act
            const found = index.atOrBelow("$.a");

            // Assert
            expect(found.sort()).toEqual(["a", "ab", "abc"]);
        });

        it("should find nothing under a path that was never filed", () => {
            // Arrange
            const index = createPathIndex<string>();
            index.add("$.a.b", "ab");

            // Act and Assert
            expect(index.atOrBelow("$.c")).toEqual([]);
            expect(index.atOrBelow("$.a.b.c")).toEqual([]);
        });
    });

    describe("above", () => {
        it("should list each filed prefix above the path, shortest first, without the path itself", () => {
            // Arrange
            const index = createPathIndex<string>();
            index.add("$", "root");
            index.add("$.a", "a");
            index.add("$.a.b.c", "abc");
            index.add("$.a.b.c.d", "abcd");

            // Act
            const found = index.above("$.a.b.c").map(([path, items]) => [path, [...items]]);

            // Assert
            expect(found).toEqual([["$", ["root"]], ["$.a", ["a"]]]);
        });
    });

    describe("remove", () => {
        it("should take the item off and prune the empty branch", () => {
            // Arrange
            const index = createPathIndex<string>();
            index.add("$.a.b", "one");
            index.add("$.a.b", "two");
            index.add("$.a", "a");

            // Act
            index.remove("$.a.b", "one");
            const afterOne = index.atOrBelow("$.a.b");
            index.remove("$.a.b", "two");
            index.remove("$.missing.path", "two");

            // Assert
            expect(afterOne).toEqual(["two"]);
            expect(index.atOrBelow("$.a")).toEqual(["a"]);
            expect(index.at("$.a.b").size).toBe(0);
        });
    });
});
