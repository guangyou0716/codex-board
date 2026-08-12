import { homedir } from "node:os";
import { promises as fs } from "node:fs";
import path from "node:path";

const BLOCKED_SEGMENTS = new Set([
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  "appdata",
  "programdata",
  "windows",
  "system32",
]);

export class PathSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathSecurityError";
  }
}

const pathSegments = (value: string) =>
  value.split(/[\\/]+/).filter(Boolean).map((segment) => segment.toLowerCase());

const containsBlockedSegment = (value: string) =>
  pathSegments(value).some((segment) => BLOCKED_SEGMENTS.has(segment));

const isInside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

export class ApprovedRoots {
  private readonly roots: string[];

  private constructor(roots: string[]) {
    this.roots = roots;
  }

  static async from(values: string[]) {
    const canonicalRoots: string[] = [];
    for (const value of values.map((item) => item.trim()).filter(Boolean)) {
      const canonical = await fs.realpath(path.resolve(value));
      if (path.parse(canonical).root === canonical) {
        throw new PathSecurityError("A filesystem root cannot be an approved project root.");
      }
      if (canonical === await fs.realpath(homedir())) {
        throw new PathSecurityError("The user home directory cannot be an approved root; choose a project folder.");
      }
      if (containsBlockedSegment(canonical)) {
        throw new PathSecurityError("Credential and system directories cannot be approved.");
      }
      if (!canonicalRoots.includes(canonical)) canonicalRoots.push(canonical);
    }
    return new ApprovedRoots(canonicalRoots);
  }

  list() {
    return [...this.roots];
  }

  async resolve(candidate: string) {
    if (!candidate || typeof candidate !== "string") {
      throw new PathSecurityError("A repository path is required.");
    }
    const canonical = await fs.realpath(path.resolve(candidate));
    if (containsBlockedSegment(canonical)) {
      throw new PathSecurityError("Credential and system directories are not accessible.");
    }
    if (!this.roots.some((root) => isInside(root, canonical))) {
      throw new PathSecurityError("The repository path is outside the approved roots.");
    }
    const stat = await fs.stat(canonical);
    if (!stat.isDirectory()) throw new PathSecurityError("The approved repository path must be a directory.");
    return canonical;
  }
}

export async function loadApprovedRoots(value = process.env.CODEX_APPROVED_ROOTS ?? "") {
  const roots = value.split(path.delimiter).map((item) => item.trim()).filter(Boolean);
  return ApprovedRoots.from(roots);
}

export function isPathInside(root: string, candidate: string) {
  return isInside(path.resolve(root), path.resolve(candidate));
}
