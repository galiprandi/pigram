import { test, expect, describe } from "bun:test";
import { markdownToTelegramHtml, chunkTelegramHtml, chunkPlainText } from "../src/telegram/markdown.js";

describe("markdownToTelegramHtml — lists", () => {
	test("renders a flat bullet list", () => {
		const html = markdownToTelegramHtml("- one\n- two");
		expect(html).toBe("• one\n• two");
	});

	test("renders a flat ordered list with sequential numbers", () => {
		const html = markdownToTelegramHtml("1. first\n2. second\n3. third");
		expect(html).toBe("1. first\n2. second\n3. third");
	});

	test("honours a non-1 ordered-list start", () => {
		const html = markdownToTelegramHtml("3. third\n4. fourth");
		expect(html).toBe("3. third\n4. fourth");
	});

	// Regression: a list item holding a nested list used to crash the whole
	// converter with "Token with 'list' type was not found", taking the entire
	// reply down with it (finalize() calls the converter outside try/catch).
	test("renders an ordered list nested inside a bullet item without crashing", () => {
		const md = "- parent item:\n  1. first sub\n  2. second sub\n- next parent";
		const html = markdownToTelegramHtml(md);
		expect(html).toBe("• parent item:\n  1. first sub\n  2. second sub\n• next parent");
	});

	test("renders a bullet list nested inside a bullet item", () => {
		const md = "- parent\n  - child a\n  - child b";
		const html = markdownToTelegramHtml(md);
		expect(html).toBe("• parent\n  • child a\n  • child b");
	});

	test("does not crash on a multi-paragraph (loose) list item", () => {
		const md = "- first paragraph\n\n  second paragraph\n- next item";
		const html = markdownToTelegramHtml(md);
		// Both paragraphs survive; continuation aligns under the marker.
		expect(html).toContain("• first paragraph");
		expect(html).toContain("second paragraph");
		expect(html).toContain("• next item");
	});

	test("preserves inline emphasis and code inside list items", () => {
		const html = markdownToTelegramHtml("- a **bold** and `code` item");
		expect(html).toBe("• a <b>bold</b> and <code>code</code> item");
	});

	test("renders GFM task lists with checkbox glyphs", () => {
		const html = markdownToTelegramHtml("- [x] done\n- [ ] todo");
		expect(html).toBe("☑ done\n☐ todo");
	});

	test("renders deeply nested mixed lists", () => {
		const md = "- L0\n  - L1\n    1. L2a\n    2. L2b";
		const html = markdownToTelegramHtml(md);
		expect(html).toBe("• L0\n  • L1\n    1. L2a\n    2. L2b");
	});
});

describe("chunkTelegramHtml", () => {
	const allUnder = (chunks: string[], max: number) =>
		chunks.every((c) => c.length <= max);

	test("returns single chunk when input fits", () => {
		expect(chunkTelegramHtml("hello")).toEqual(["hello"]);
	});

	test("splits plain text at maxLength boundary", () => {
		const chunks = chunkTelegramHtml("a".repeat(5000));
		expect(chunks).toHaveLength(2);
		expect(chunks[0]).toHaveLength(4096);
		expect(chunks[1]).toHaveLength(904);
		expect(allUnder(chunks, 4096)).toBe(true);
	});

	test("preserves tag balance across chunks", () => {
		const html = "<b>" + "x".repeat(5000) + "</b>";
		const chunks = chunkTelegramHtml(html);
		expect(allUnder(chunks, 4096)).toBe(true);
		// Each chunk should be valid HTML with balanced tags
		for (const chunk of chunks) {
			expect(chunk).toContain("<b>");
			expect(chunk).toContain("</b>");
		}
	});

	test("handles nested tags without overflow", () => {
		const html = "<b><i><code>" + "y".repeat(5000) + "</code></i></b>";
		const chunks = chunkTelegramHtml(html);
		expect(allUnder(chunks, 4096)).toBe(true);
	});

	test("handles tag appearing at the boundary", () => {
		// Bold tag starts at position 4093 — must split before it
		const html = "x".repeat(4093) + "<b>heading</b>\n\nMore text";
		const chunks = chunkTelegramHtml(html);
		expect(allUnder(chunks, 4096)).toBe(true);
	});

	test("handles link with long href at boundary", () => {
		const html = "y".repeat(4080) + '<a href="https://example.com/long-path">link</a> rest';
		const chunks = chunkTelegramHtml(html);
		expect(allUnder(chunks, 4096)).toBe(true);
	});

	test("handles link inside bold", () => {
		const html = '<b><a href="https://example.com/long-url">' + "z".repeat(4050) + "</a></b>";
		const chunks = chunkTelegramHtml(html);
		expect(allUnder(chunks, 4096)).toBe(true);
	});

	test("handles pre blocks", () => {
		const html = "<pre>" + "line\n".repeat(500) + "</pre>";
		const chunks = chunkTelegramHtml(html);
		expect(allUnder(chunks, 4096)).toBe(true);
	});

	test("handles entity-heavy content", () => {
		const html = "&amp;".repeat(3000) + "&lt;".repeat(1000);
		const chunks = chunkTelegramHtml(html);
		expect(allUnder(chunks, 4096)).toBe(true);
	});
});

describe("chunkPlainText", () => {
	test("returns single chunk when text fits", () => {
		expect(chunkPlainText("short text")).toEqual(["short text"]);
	});

	test("splits at paragraph boundaries", () => {
		const text = "a".repeat(2000) + "\n\n" + "b".repeat(2000) + "\n\n" + "c".repeat(500);
		const chunks = chunkPlainText(text);
		expect(chunks).toHaveLength(2);
		expect(chunks.every((c) => c.length <= 4096)).toBe(true);
		expect(chunks[0]).toContain("a".repeat(100)); // first paragraph in first chunk
		expect(chunks[1]).toContain("c".repeat(100)); // second paragraph in second chunk
	});

	test("falls back to single newline when no paragraph break", () => {
		const text = "a".repeat(2000) + "\n" + "b".repeat(2000) + "\n" + "c".repeat(500);
		const chunks = chunkPlainText(text);
		expect(chunks.every((c) => c.length <= 4096)).toBe(true);
	});

	test("hard-splits when no newlines at all", () => {
		const text = "x".repeat(5000);
		const chunks = chunkPlainText(text);
		expect(chunks).toHaveLength(2);
		expect(chunks[0]).toHaveLength(4096);
		expect(chunks[1]).toHaveLength(904);
	});
});
