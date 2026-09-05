import { runMediaTagTick } from "./agents/media-tag-tick.js";

/**
 * Tags the whole untagged backlog right now instead of waiting for the
 * 10-minute tick to chew through it five photos at a time — a freshly
 * uploaded 70-photo bank would otherwise take over two hours to become
 * rankable.
 *
 * usage: tsx src/tag-media-now.ts
 */
let total = 0;
for (;;) {
  const attempted = await runMediaTagTick();
  if (attempted === 0) break;
  total += attempted;
  console.log(`${total} fotos procesadas…`);
}
console.log(`listo: ${total} fotos procesadas`);
process.exit(0);
