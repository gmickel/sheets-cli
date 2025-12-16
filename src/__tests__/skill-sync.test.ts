import { describe, expect, test } from "bun:test";
import { SKILL_CONTENT } from "../skill";

const normalize = (input: string): string =>
  input.replaceAll("\r\n", "\n").trimEnd();

describe("skill", () => {
  test("SKILL_CONTENT matches SKILL.md", async () => {
    const skillPath = new URL("../../SKILL.md", import.meta.url);
    const file = Bun.file(skillPath);
    const markdown = await file.text();
    expect(normalize(SKILL_CONTENT)).toBe(normalize(markdown));
  });
});
