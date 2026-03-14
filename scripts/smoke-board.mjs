import process from "node:process";

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.KANBAN_BASE_URL ?? null,
    appKey: process.env.KANBAN_APP_KEY ?? process.env.APP_ACCESS_KEY ?? null,
    pipelineId: null,
    refresh: false,
    skipUnauthorizedCheck: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--base-url") {
      options.baseUrl = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (token === "--app-key") {
      options.appKey = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (token === "--pipeline-id") {
      options.pipelineId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (token === "--refresh") {
      options.refresh = true;
      continue;
    }

    if (token === "--skip-unauthorized-check") {
      options.skipUnauthorizedCheck = true;
      continue;
    }
  }

  return options;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildBoardUrl(baseUrl, pipelineId, refresh) {
  const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, "");
  const target = new URL(`${normalizedBaseUrl}/api/board`);

  if (pipelineId) {
    target.searchParams.set("pipelineId", String(pipelineId));
  }

  if (refresh) {
    target.searchParams.set("refresh", "1");
  }

  return target;
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, init);
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  return { response, payload };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  assert(options.baseUrl, "Informe --base-url ou defina KANBAN_BASE_URL.");
  assert(options.appKey, "Informe --app-key ou defina KANBAN_APP_KEY/APP_ACCESS_KEY.");

  const boardUrl = buildBoardUrl(options.baseUrl, options.pipelineId, options.refresh);
  const { response, payload } = await requestJson(boardUrl, {
    headers: {
      "x-kanban-app-key": options.appKey,
      Accept: "application/json",
    },
  });

  assert(response.status === 200, `Board retornou status inesperado: ${response.status}`);
  assert(payload && typeof payload === "object", "Board retornou payload invalido.");
  assert(Number.isInteger(payload.accountId), "Resposta sem accountId valido.");
  assert(payload.selectedPipeline?.name, "Resposta sem selectedPipeline.name.");
  assert(Array.isArray(payload.columns), "Resposta sem columns.");
  assert(payload.metrics && typeof payload.metrics.totalCards === "number", "Resposta sem metrics.totalCards.");

  console.log(`Board URL: ${boardUrl.toString()}`);
  console.log(`Pipeline: ${payload.selectedPipeline.name}`);
  console.log(`Columns: ${payload.columns.length}`);
  console.log(`Total cards: ${payload.metrics.totalCards}`);

  if (!options.skipUnauthorizedCheck) {
    const unauthorized = await requestJson(boardUrl, {
      headers: {
        Accept: "application/json",
      },
    });

    assert(
      unauthorized.response.status === 401,
      `Board sem autenticacao deveria retornar 401, retornou ${unauthorized.response.status}`,
    );
    console.log("Unauthorized check: OK");
  }

  console.log("OK");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Falha no smoke test do board.";
  console.error(message);
  process.exit(1);
});
