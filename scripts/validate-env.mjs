import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appDir, "..", "..");

function parseArgs(argv) {
  const options = {
    envFile: null,
    allowMissingEnvFile: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--env-file") {
      options.envFile = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (token === "--require-env-file") {
      options.allowMissingEnvFile = false;
      continue;
    }
  }

  return options;
}

function readEnvFile(envFilePath) {
  if (!envFilePath) {
    return {};
  }

  if (!fs.existsSync(envFilePath)) {
    return null;
  }

  const content = fs.readFileSync(envFilePath, "utf8");
  const result = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalIndex = line.indexOf("=");
    if (equalIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalIndex).trim();
    const value = line.slice(equalIndex + 1).trim();
    result[key] = value;
  }

  return result;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isPlaceholder(value) {
  const normalized = String(value ?? "").toLowerCase();
  return (
    normalized.includes("cole-o-token") ||
    normalized.includes("gere-uma-chave") ||
    normalized.includes("aqui")
  );
}

function resolveKommoStructurePath(value) {
  if (!value) {
    return null;
  }

  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const defaultEnvFile = path.join(appDir, ".env.local");
  const envFile = options.envFile
    ? path.resolve(process.cwd(), options.envFile)
    : defaultEnvFile;
  const envFromFile = readEnvFile(envFile);

  if (envFromFile === null && !options.allowMissingEnvFile) {
    throw new Error(`Arquivo de env nao encontrado: ${envFile}`);
  }

  const mergedEnv = {
    ...(envFromFile ?? {}),
    ...process.env,
  };

  const baseUrl = mergedEnv.CHATWOOT_BASE_URL;
  const accountId = mergedEnv.CHATWOOT_ACCOUNT_ID;
  const apiToken = mergedEnv.CHATWOOT_API_TOKEN;
  const appAccessKey = mergedEnv.APP_ACCESS_KEY;
  const kommoStructurePath = mergedEnv.KOMMO_STRUCTURE_PATH;
  const bundledStructurePath = path.join(appDir, "src", "data", "kommo-pipelines.json");

  assert(baseUrl, "CHATWOOT_BASE_URL ausente.");
  assert(accountId, "CHATWOOT_ACCOUNT_ID ausente.");
  assert(apiToken, "CHATWOOT_API_TOKEN ausente.");
  assert(appAccessKey, "APP_ACCESS_KEY ausente.");
  assert(!isPlaceholder(apiToken), "CHATWOOT_API_TOKEN ainda parece placeholder.");
  assert(!isPlaceholder(appAccessKey), "APP_ACCESS_KEY ainda parece placeholder.");
  assert(String(appAccessKey).length >= 24, "APP_ACCESS_KEY precisa ter pelo menos 24 caracteres.");

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error("CHATWOOT_BASE_URL precisa ser uma URL valida.");
  }

  const parsedAccountId = Number(accountId);
  assert(Number.isInteger(parsedAccountId) && parsedAccountId > 0, "CHATWOOT_ACCOUNT_ID precisa ser inteiro positivo.");

  const resolvedKommoPath = resolveKommoStructurePath(kommoStructurePath);
  if (resolvedKommoPath) {
    assert(fs.existsSync(resolvedKommoPath), `KOMMO_STRUCTURE_PATH nao encontrado: ${resolvedKommoPath}`);
  } else {
    assert(fs.existsSync(bundledStructurePath), `Bundle estatico nao encontrado: ${bundledStructurePath}`);
  }

  console.log("OK");
  console.log(`CHATWOOT_BASE_URL: ${parsedUrl.origin}`);
  console.log(`CHATWOOT_ACCOUNT_ID: ${parsedAccountId}`);
  console.log(`Fonte de estrutura: ${resolvedKommoPath ?? bundledStructurePath}`);
  console.log(`Env file: ${envFromFile ? envFile : "nao encontrado; usando process.env"}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Falha ao validar ambiente.";
  console.error(message);
  process.exit(1);
}
