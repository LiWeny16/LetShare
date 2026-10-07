/**
 * X5 静态检查：时间/随机数必须来自注入的 Clock / Rng，不得被业务代码当作正确性前提。
 *
 * 全仓只允许 `src/core/transport/systemClock.ts` 直连 Date.now() / setTimeout /
 * clearTimeout / setInterval / clearInterval / Math.random()。其余核心代码一律经
 * 注入对象取时间与随机数，测试因此可以用虚拟时钟与固定种子（不 real sleep）。
 *
 * 这是 CONFORMANCE C-03 允许的"静态检查（P2）"手段：它锁的是**结构**（有没有直连），
 * 行为部分由 reconnectConvergence / livenessProbe / backgroundExemption 三份行为测试锁。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");
/** 本片（V2）属主的核心域；其余 core 域由各自的片负责同一规则。 */
const CORE_ROOT = join(REPO_ROOT, "src", "core", "transport");
/** 注入边界：唯一允许直连系统时钟/随机数的文件。 */
const ALLOWED = "src/core/transport/systemClock.ts";

/** 只匹配"裸调用"，放过 `this.clock.setTimeout(...)` / `opts.clock.now()` 这类注入调用。 */
const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ["Date.now()", /(?<![.\w])Date\.now\s*\(/],
  ["Math.random()", /(?<![.\w])Math\.random\s*\(/],
  ["setTimeout()", /(?<![.\w])setTimeout\s*\(/],
  ["clearTimeout()", /(?<![.\w])clearTimeout\s*\(/],
  ["setInterval()", /(?<![.\w])setInterval\s*\(/],
  ["clearInterval()", /(?<![.\w])clearInterval\s*\(/],
];

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      listTsFiles(full, out);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function relPosix(file: string): string {
  return relative(REPO_ROOT, file).split(sep).join("/");
}

/** 剔除注释与接口方法签名：它们不是"调用"，不应被判为直连。 */
function stripNoise(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .split("\n")
    .filter((line) => !/^\s*(?:readonly\s+)?[A-Za-z_$][\w$]*\s*\([^;]*\)\s*:\s*[^{;]*;\s*$/.test(line))
    .join("\n");
}

test("X5：src/core/transport 只有 systemClock.ts 可以直连系统时钟与随机数", () => {
  const violations: string[] = [];
  for (const file of listTsFiles(CORE_ROOT)) {
    const rel = relPosix(file);
    if (rel === ALLOWED) continue;
    const source = stripNoise(readFileSync(file, "utf8"));
    for (const [label, pattern] of FORBIDDEN) {
      const match = pattern.exec(source);
      if (match !== null) {
        violations.push(`${rel} 直连了 ${label}（应改为注入 Clock / Rng）`);
      }
    }
  }
  assert.deepEqual(violations, [], "核心代码不得绕过 Clock/Rng 注入（其余 core 域由各自片负责同一规则）");
});

test("X5：注入边界文件必须真的导出 Clock 与 Rng 实例", () => {
  const source = readFileSync(join(CORE_ROOT, "systemClock.ts"), "utf8");
  assert.match(source, /export const systemClock: Clock/);
  assert.match(source, /export const systemRng: Rng/);
  assert.match(source, /Date\.now\s*\(/);
  assert.match(source, /Math\.random\s*\(/);
});

test("X5：核心重试调度不使用裸 setInterval（重试只经 RetrySupervisor）", () => {
  const raw = readFileSync(join(CORE_ROOT, "RetrySupervisor.ts"), "utf8");
  const source = stripNoise(raw);
  assert.doesNotMatch(source, /(?<![.\w])setInterval\s*\(/);
  assert.doesNotMatch(source, /(?<![.\w])setTimeout\s*\(/);
  assert.match(raw, /this\.clock\.setTimeout\(/, "排下一次必须经注入的 Clock");
});
