import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { getServerEnv } from "@/lib/env";
import { KommoPipeline } from "@/lib/types";

interface RawKommoStructure {
  endpoints?: {
    leadPipelines?: {
      json?: {
        _embedded?: {
          pipelines?: Array<{
            id: number;
            name: string;
            sort: number;
            is_main: boolean;
            _embedded?: {
              statuses?: Array<{
                id: number;
                name: string;
                sort: number;
                color: string;
                type: number;
                pipeline_id: number;
              }>;
            };
          }>;
        };
      };
    };
  };
}

let cachedPipelines: KommoPipeline[] | null = null;

function repoRoot() {
  return resolve(process.cwd(), "..", "..");
}

function resolveStructurePath() {
  const { KOMMO_STRUCTURE_PATH } = getServerEnv();

  if (KOMMO_STRUCTURE_PATH) {
    return isAbsolute(KOMMO_STRUCTURE_PATH)
      ? KOMMO_STRUCTURE_PATH
      : resolve(repoRoot(), KOMMO_STRUCTURE_PATH);
  }

  const backupDirectory = join(repoRoot(), "backups");
  const fileName = readdirSync(backupDirectory)
    .filter((entry) => /^kommo-structure-.*\.json$/i.test(entry))
    .sort()
    .at(-1);

  if (!fileName) {
    throw new Error(
      "Nenhum arquivo kommo-structure-*.json foi encontrado em backups/.",
    );
  }

  return join(backupDirectory, fileName);
}

export function getKommoPipelines() {
  if (cachedPipelines) {
    return cachedPipelines;
  }

  const raw = JSON.parse(
    readFileSync(resolveStructurePath(), "utf8"),
  ) as RawKommoStructure;

  const pipelines =
    raw.endpoints?.leadPipelines?.json?._embedded?.pipelines ?? [];

  cachedPipelines = pipelines
    .map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      sort: pipeline.sort,
      isMain: pipeline.is_main,
      statuses: (pipeline._embedded?.statuses ?? [])
        .map((status) => ({
          id: status.id,
          name: status.name,
          sort: status.sort,
          color: status.color,
          type: status.type,
          pipelineId: status.pipeline_id,
        }))
        .sort((left, right) => left.sort - right.sort),
    }))
    .sort((left, right) => left.sort - right.sort);

  return cachedPipelines;
}

export function getPipelineById(pipelineId?: number | null) {
  const pipelines = getKommoPipelines();

  if (!pipelines.length) {
    throw new Error("Nenhum funil do Kommo foi encontrado no backup estrutural.");
  }

  if (pipelineId) {
    const matched = pipelines.find((pipeline) => pipeline.id === pipelineId);
    if (matched) {
      return matched;
    }
  }

  return pipelines.find((pipeline) => pipeline.isMain) ?? pipelines[0];
}
