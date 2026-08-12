import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { BridgeRepository } from "./types.ts";
import { ApprovedRoots, PathSecurityError } from "./path-security.ts";

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 2 * 1024 * 1024;

async function git(cwd: string, args: string[]) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      windowsHide: true,
      maxBuffer: GIT_MAX_BUFFER,
      shell: false,
    });
    return result.stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Git ${args[0] ?? "operation"} failed: ${message}`);
  }
}

const optionalGit = async (cwd: string, args: string[]) => {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
};

export async function readRepository(roots: ApprovedRoots, candidate: string): Promise<BridgeRepository> {
  const localPath = await roots.resolve(candidate);
  const topLevel = await git(localPath, ["rev-parse", "--show-toplevel"]);
  const canonicalTopLevel = await roots.resolve(topLevel);
  const [currentBranch, remote, lastCommit, status] = await Promise.all([
    optionalGit(canonicalTopLevel, ["branch", "--show-current"]),
    optionalGit(canonicalTopLevel, ["remote", "get-url", "origin"]),
    optionalGit(canonicalTopLevel, ["rev-parse", "--short", "HEAD"]),
    optionalGit(canonicalTopLevel, ["status", "--porcelain=v1"]),
  ]);
  const name = path.basename(canonicalTopLevel) || canonicalTopLevel;
  return {
    name,
    localPath: canonicalTopLevel,
    remote,
    currentBranch: currentBranch || null,
    defaultBranch: currentBranch || null,
    dirty: status == null ? null : status.length > 0,
    lastCommit,
    lastSeen: new Date().toISOString(),
  };
}

async function walk(root: string, current: string, depth: number, maxDepth: number, seen: Set<string>, found: Set<string>) {
  if (depth > maxDepth) return;
  let canonical: string;
  try {
    canonical = await fs.realpath(current);
  } catch {
    return;
  }
  if (seen.has(canonical)) return;
  seen.add(canonical);

  let entries;
  try {
    entries = await fs.readdir(canonical, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.some((entry) => entry.name === ".git")) {
    found.add(canonical);
    return;
  }
  if (depth === maxDepth) return;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next" || entry.name === "dist" || entry.name === "build" || entry.name === "target") continue;
    await walk(root, path.join(canonical, entry.name), depth + 1, maxDepth, seen, found);
  }
}

export async function discoverRepositories(roots: ApprovedRoots, maxDepth = Number(process.env.CODEX_DISCOVERY_MAX_DEPTH ?? 4)) {
  const found = new Set<string>();
  const seen = new Set<string>();
  for (const root of roots.list()) await walk(root, root, 0, Math.min(Math.max(maxDepth, 1), 8), seen, found);
  const repositories: BridgeRepository[] = [];
  for (const candidate of found) {
    try {
      repositories.push(await readRepository(roots, candidate));
    } catch (error) {
      if (!(error instanceof PathSecurityError)) continue;
    }
  }
  return repositories.sort((a, b) => a.name.localeCompare(b.name));
}

export interface DiffFile {
  fileName: string;
  additions: number;
  deletions: number;
  lines: string[];
}

export function parseNumstat(output: string) {
  const counts = new Map<string, { additions: number; deletions: number }>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^(\d+|-)[\t ]+(\d+|-)[\t ]+(.+)$/);
    if (!match) continue;
    counts.set(match[3], { additions: match[1] === "-" ? 0 : Number(match[1]), deletions: match[2] === "-" ? 0 : Number(match[2]) });
  }
  return counts;
}

export function parseUnifiedDiff(output: string, counts = new Map<string, { additions: number; deletions: number }>()) {
  const files: DiffFile[] = [];
  const blocks = output.split(/^diff --git /m).slice(1);
  for (const block of blocks) {
    const header = block.split(/\r?\n/, 1)[0] ?? "";
    const headerMatch = header.match(/^a\/(.+) b\/(.+)$/);
    const plusPath = block.match(/^\+\+\+ b\/(.+)$/m)?.[1];
    const fileName = plusPath ?? headerMatch?.[2] ?? headerMatch?.[1] ?? "unknown";
    const count = counts.get(fileName) ?? { additions: 0, deletions: 0 };
    files.push({
      fileName,
      additions: count.additions,
      deletions: count.deletions,
      lines: block.split(/\r?\n/).filter((line) => line.startsWith("@@") || line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")),
    });
  }
  return files;
}

export async function readDiff(roots: ApprovedRoots, candidate: string) {
  const localPath = await roots.resolve(candidate);
  await git(localPath, ["rev-parse", "--show-toplevel"]);
  const [numstat, diff] = await Promise.all([
    git(localPath, ["diff", "--numstat", "--no-ext-diff", "--no-color"]),
    git(localPath, ["diff", "--unified=3", "--no-ext-diff", "--no-color"]),
  ]);
  return parseUnifiedDiff(diff, parseNumstat(numstat));
}
