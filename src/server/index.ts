import { startHandlelisteApp } from "./application.js";

const port = readPort(process.env.HANDLELISTE_PORT);
const host = process.env.HANDLELISTE_HOST ?? "0.0.0.0";
const dataDirectory = process.env.HANDLELISTE_DATA_DIR ?? "/data";
const trustedIngressAddresses = process.env.HANDLELISTE_TRUSTED_INGRESS_ADDRESSES
  ?.split(",")
  .map((address) => address.trim())
  .filter(Boolean);

const app = await startHandlelisteApp({
  dataDirectory,
  host,
  port,
  ...(trustedIngressAddresses ? { trustedIngressAddresses } : {}),
});

console.log(`Handleliste listening at ${app.origin}`);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await app.close();
  process.exitCode = 0;
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

function readPort(value: string | undefined): number {
  const portValue = value === undefined ? 8099 : Number(value);
  if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65_535) {
    throw new Error("HANDLELISTE_PORT must be a valid TCP port");
  }
  return portValue;
}
