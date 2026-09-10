// 2.2: turns the client's script PDF into { videos: [{ id, titulo,
// mostrarTitulo, guion }] }. Two paths, in order:
//  1. The local LLM (already in the repo — LM Studio), which reads the
//     whole raw text and returns structured JSON directly. Free-form
//     writing works here as long as the model can tell where one video's
//     script ends and the next begins.
//  2. A heading-based regex parser, used when the LLM is unavailable or
//     rejects the document — never silently drops content: anything it
//     can't confidently place gets `necesitaRevision: true` instead of
//     being guessed at.
// Never OCR: a scanned PDF (no text layer) fails loudly (see extractPdfText).

import { AppError } from "@pulso/shared/errors";
import { callLlmStructured } from "@pulso/shared/llm";
import pdfParse from "pdf-parse";
import { scriptDocumentSchema, type ScriptDocument } from "./types.js";

export class PdfScriptError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, "PDF_SCRIPT_ERROR", cause);
    this.name = "PdfScriptError";
  }
}

/** Guards against a scanned PDF (image-only pages, no text layer) — OCR is explicitly out of scope. */
const MIN_CHARS_PER_PAGE = 20;

export async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  let result: { text: string; numpages: number };
  try {
    result = await pdfParse(pdfBuffer);
  } catch (err) {
    throw new PdfScriptError("no se pudo leer el PDF — ¿el archivo está corrupto?", err);
  }

  const meaningfulChars = result.text.replace(/\s/g, "").length;
  if (result.numpages > 0 && meaningfulChars < MIN_CHARS_PER_PAGE * result.numpages) {
    throw new PdfScriptError(
      "el PDF no tiene una capa de texto (parece escaneado). Esta versión no hace OCR: " +
        "exportá el guion desde el documento original (Word, Google Docs) en vez de una imagen escaneada.",
    );
  }

  return result.text;
}

const STRUCTURING_PROMPT_HEADER = `Convierte el siguiente guion de video (uno o más videos en el mismo documento) a JSON.
Para cada video identifica: un id corto (video-1, video-2...), el título si lo indica (o null si no lleva),
si el título debe mostrarse en pantalla (mostrarTitulo: true/false — asumí true si hay un título indicado
y no dice lo contrario), y el guion hablado completo tal como está escrito, sin resumir ni corregir.

Responde SOLO con el JSON, sin explicación ni markdown, con esta forma exacta:
{ "videos": [{ "id": string, "titulo": string | null, "mostrarTitulo": boolean, "guion": string }] }

Documento:
`;

async function structureWithLlm(rawText: string): Promise<ScriptDocument | undefined> {
  try {
    // necesitaRevision defaults to false (see scriptVideoSchema) since the
    // LLM's prompt doesn't ask for it — that flag is the fallback parser's
    // own way of admitting uncertainty; an LLM that couldn't parse this
    // confidently fails schema validation instead of guessing.
    return await callLlmStructured(`${STRUCTURING_PROMPT_HEADER}${rawText}`, scriptDocumentSchema, {
      maxTokens: 8192,
    });
  } catch {
    // Deliberately swallowed: the local model being unreachable, overloaded,
    // or unable to follow the schema all mean the same thing to this
    // caller — fall back to the heading parser rather than fail the whole
    // pipeline over the one step that has a local-model dependency.
    return undefined;
  }
}

// Recognizes headers like "Video 1", "VIDEO 2:", "Guion 3", "Título:" at the
// start of a line — free-form beyond that, per the ticket's requirement
// that the parser tolerate loose formatting rather than a strict template.
const VIDEO_HEADER = /^\s*(?:video|guion|gui[oó]n)\s*(\d+)\s*[:.-]?\s*$/im;
const TITLE_LINE = /^\s*t[ií]tulo\s*:\s*(.*)$/im;

function splitIntoVideoBlocks(text: string): string[] {
  const matches = [...text.matchAll(new RegExp(VIDEO_HEADER.source, "gim"))];
  if (matches.length === 0) return [text];

  const blocks: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i]!.index! + matches[i]![0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : text.length;
    blocks.push(text.slice(start, end).trim());
  }
  return blocks;
}

/**
 * Tolerant of free-form writing, but honest about it: a block with no
 * recognizable "Título:" line still gets a script (mostrarTitulo defaults
 * to false, since there's nothing to show), and is flagged for a human to
 * check in the review screen rather than silently guessing a title.
 */
export function parseByHeadings(rawText: string): ScriptDocument {
  const blocks = splitIntoVideoBlocks(rawText);

  const videos = blocks.map((block, index) => {
    const titleMatch = TITLE_LINE.exec(block);
    const titulo = titleMatch?.[1]?.trim() || null;
    const guion = block.replace(TITLE_LINE, "").trim();

    return {
      id: `video-${index + 1}`,
      titulo,
      mostrarTitulo: Boolean(titulo),
      guion,
      // No título line found at all is the ambiguous case worth a human
      // look; an explicitly-absent title ("sin título") is not.
      necesitaRevision: !titleMatch,
    };
  });

  return scriptDocumentSchema.parse({ videos });
}

export async function parseScriptPdf(pdfBuffer: Buffer): Promise<ScriptDocument> {
  const rawText = await extractPdfText(pdfBuffer);

  const llmResult = await structureWithLlm(rawText);
  if (llmResult) return llmResult;

  return parseByHeadings(rawText);
}
