import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect } from "@playwright/test";

import { toDueAt } from "@/lib/time";

import type { TestUser } from "../support/supabase";

/**
 * 평가 실행기(`*.grade.ts`)가 함께 쓰는 조각. 데이터 형식은 `e2e/fixtures/captures/README.md`.
 */

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/** 케이스가 공통으로 드는 칸. 경로별 `expect` 등은 호출부가 타입으로 더한다. */
export interface BaseCase {
  image: string;
  capturedAt: string;
  timezone: string;
  existingTags: string[];
}

/** `root` 아래 폴더마다 `expected.json`을 읽어 케이스를 편다. `name`은 `폴더/사진`이다. */
export function loadCases<T extends BaseCase>(root: string): (T & { folder: string; name: string })[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((dir) => {
      const folder = path.join(root, dir.name);
      const { cases } = JSON.parse(readFileSync(path.join(folder, "expected.json"), "utf8")) as { cases: T[] };
      return cases.map((c) => ({ ...c, folder, name: `${dir.name}/${c.image}` }));
    });
}

export async function readCaptureImage(folder: string, image: string) {
  const bytes = await readFile(path.join(folder, image));
  return { bytes, mimeType: MIME[path.extname(image).toLowerCase()]! };
}

/** 실행 전 `todo`로 심는 태스크. 완료 케이스와 생성의 중복 케이스(`07-duplicate`)가 쓴다. */
export interface SeedTask {
  title: string;
  dueAt: string | null;
  tags: string[];
}

/** 모든 생성 케이스에 공통으로 까는 미끼 후보(`L-P1-08`). 이유는 파일 안 `note`. */
export const DECOY_TASKS: SeedTask[] = (
  JSON.parse(readFileSync("e2e/fixtures/captures/decoy-tasks.json", "utf8")) as { titles: string[] }
).titles.map((title) => ({ title, dueAt: null, tags: [] }));

/**
 * 태스크를 `todo`로 심는다. **순서대로 하나씩** 넣는다 — 생성 에이전트는 최근 생성순으로 후보를
 * 자르므로, 뒤에 넣은 것(케이스의 `seedTasks`)이 더 최근이 되어야 상한에 밀리지 않는다.
 */
export async function seedTasks(user: TestUser, tagIds: Map<string, string>, tasks: SeedTask[], timezone: string) {
  for (const task of tasks) {
    // 세트의 `dueAt`은 날짜만 적혀 있다 — 에이전트가 만드는 것과 같이 그날의 끝으로 심는다(설계 결정 14).
    const { error } = await user.client.rpc("create_task", {
      p_title: task.title,
      p_due_at: task.dueAt ? (toDueAt(task.dueAt, null, timezone) ?? undefined) : undefined,
      p_due_has_time: false,
      p_tag_ids: task.tags.map((name) => tagIds.get(name)!),
    });
    expect(error).toBeNull();
  }
}

/** 케이스의 `existingTags`를 심고 이름 → id를 돌려준다. '미분류'는 가입 트리거가 이미 만들었다. */
export async function seedTags(user: TestUser, names: string[]): Promise<Map<string, string>> {
  const seed = names.filter((name) => name !== "미분류");
  const { error } = await user.client.from("tags").insert(seed.map((name) => ({ user_id: user.user.id, name })));
  expect(error).toBeNull();

  const { data, error: readError } = await user.client.from("tags").select("id, name");
  expect(readError).toBeNull();
  return new Map(data!.map((tag) => [tag.name, tag.id]));
}
