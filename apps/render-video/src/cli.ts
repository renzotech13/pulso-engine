import { writeFile } from "node:fs/promises";
import { renderLocal } from "./render";
import { isKnownRemotionRef } from "./registry";

// Invoked as a subprocess (via tsx), never imported — see index.ts for why.
const [, , compositionId, propsJson, outputPath] = process.argv;

async function main() {
  if (!compositionId || !propsJson || !outputPath || !isKnownRemotionRef(compositionId)) {
    throw new Error("usage: tsx cli.ts <compositionId> <propsJson> <outputPath>");
  }

  const props = JSON.parse(propsJson) as Record<string, unknown>;
  const buffer = await renderLocal(compositionId, props);
  await writeFile(outputPath, buffer);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
