import { readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export interface TaskRef {
  /** Numeric id, e.g. 1. */
  num: number;
  /** Directory name, e.g. "01-fix-failing-test". */
  name: string;
  /** Absolute path to the task directory. */
  dir: string;
  missionPath: string;
  fixtureDir: string;
  scriptsDir: string;
}

/** Discover benchmark tasks under tasks/NN-name that contain a mission.yaml. */
export function discoverTasks(tasksRoot: string): TaskRef[] {
  const root = resolve(tasksRoot);
  if (!existsSync(root)) return [];
  const tasks: TaskRef[] = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    const missionPath = join(dir, "mission.yaml");
    if (!existsSync(missionPath)) continue;
    const match = name.match(/^(\d+)/);
    if (!match) continue;
    tasks.push({
      num: Number(match[1]),
      name,
      dir,
      missionPath,
      fixtureDir: join(dir, "fixture"),
      scriptsDir: join(dir, "engine-scripts"),
    });
  }
  return tasks.sort((a, b) => a.num - b.num);
}

/** Filter tasks by a list of numbers (1-based); empty list = all. */
export function selectTasks(all: TaskRef[], nums: number[]): TaskRef[] {
  if (nums.length === 0) return all;
  const set = new Set(nums);
  return all.filter((t) => set.has(t.num));
}
