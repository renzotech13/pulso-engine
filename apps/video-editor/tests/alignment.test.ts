import { describe, expect, it } from "vitest";
import {
  alignWordSequences,
  assignAssetToScript,
  buildEdl,
  diceSimilarity,
  normalizeText,
  segmentIntoRuns,
  stripLeadingCountdown,
  textSimilarity,
} from "../src/pipeline/alignment.js";
import type { AudioAnalysis, ScriptVideo, TranscriptWord } from "../src/pipeline/types.js";

function word(text: string, startSec: number, endSec: number): TranscriptWord {
  return { text, startSec, endSec };
}

describe("alignWordSequences", () => {
  it("aligns an identical sequence one-to-one", () => {
    const a = ["hoy", "te", "explico"];
    expect(alignWordSequences(a, a)).toEqual([0, 1, 2]);
  });

  it("localizes a split word instead of shifting everything after it", () => {
    // Real case from transcribed audio: "RUC" (1 script word) heard as two
    // words ("aria", "uce"). Everything before and after should stay
    // exactly 1:1 — only the two words touching the actual split move.
    const transcript = ["hoy", "te", "explico", "como", "sacar", "tu", "aria", "uce", "en", "sunarp"];
    const script = ["hoy", "te", "explico", "como", "sacar", "tu", "ruc", "en", "sunarp"];

    const alignment = alignWordSequences(transcript, script);

    expect(alignment.slice(0, 6)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(alignment.slice(8)).toEqual([7, 8]);
    // "aria" and "uce" resolve the split right there at index 6 ("ruc") —
    // one of the two aligns to it and the other is unaligned (an edit-distance
    // tie either way is fine — nothing needs to land on an unrelated word
    // from smearing the gap across the segment, which is the actual bug this
    // guards against).
    expect([alignment[6], alignment[7]].filter((x) => x === 6)).toHaveLength(1);
    expect([alignment[6], alignment[7]].filter((x) => x === null)).toHaveLength(1);
  });

  it("marks a transcript word with no script counterpart as unaligned", () => {
    const transcript = ["eh", "hoy", "te", "explico"];
    const script = ["hoy", "te", "explico"];
    const alignment = alignWordSequences(transcript, script);
    expect(alignment[0]).toBeNull();
    expect(alignment.slice(1)).toEqual([0, 1, 2]);
  });
});

describe("normalizeText", () => {
  it("strips accents, punctuation and case", () => {
    expect(normalizeText("¡Hola, Ángel! ¿Cómo estás?")).toBe("hola angel como estas");
  });
});

describe("textSimilarity / diceSimilarity", () => {
  it("is 1 for identical text", () => {
    expect(textSimilarity("hola mundo cruel", "hola mundo cruel")).toBe(1);
  });

  it("is 0 for completely unrelated text", () => {
    expect(textSimilarity("formalizar tu empresa hoy", "receta de pastel de chocolate")).toBe(0);
  });

  it("rewards partial overlap between the two extremes", () => {
    const score = textSimilarity("tu az bajo la manga", "guarda tu az bajo la manga siempre");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("treats two empty sets as identical, not undefined", () => {
    expect(diceSimilarity(new Set(), new Set())).toBe(1);
  });
});

describe("segmentIntoRuns", () => {
  it("keeps one run when there is no silence between words", () => {
    const words = [word("hola", 0, 0.3), word("mundo", 0.35, 0.7)];
    const runs = segmentIntoRuns(words, []);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.words).toHaveLength(2);
  });

  it("splits into two runs at a detected silence", () => {
    const words = [word("hola", 0, 0.3), word("mundo", 3, 3.4)];
    const runs = segmentIntoRuns(words, [{ startSec: 0.3, endSec: 3 }]);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.words.map((w) => w.text)).toEqual(["hola"]);
    expect(runs[1]!.words.map((w) => w.text)).toEqual(["mundo"]);
  });

  it("splits on a large timestamp gap even without a formally detected silence", () => {
    const words = [word("hola", 0, 0.3), word("mundo", 5, 5.4)];
    const runs = segmentIntoRuns(words, []);
    expect(runs).toHaveLength(2);
  });

  it("returns nothing for an empty word list", () => {
    expect(segmentIntoRuns([], [])).toEqual([]);
  });
});

describe("stripLeadingCountdown", () => {
  it("drops a clapperboard countdown that runs straight into the line", () => {
    const words = [word("tres", 0, 0.2), word("dos", 0.3, 0.5), word("uno", 0.6, 0.8), word("accion", 0.9, 1.2), word("hoy", 1.3, 1.5)];
    expect(stripLeadingCountdown(words).map((w) => w.text)).toEqual(["hoy"]);
  });

  it("drops the countdown even without a cue word after it", () => {
    const words = [word("dos", 0, 0.2), word("uno", 0.3, 0.5), word("hoy", 0.6, 0.8)];
    expect(stripLeadingCountdown(words).map((w) => w.text)).toEqual(["hoy"]);
  });

  it("leaves a single leading number alone — real script content starts with one too", () => {
    // ADS-06's real line: "Uno: revisamos gratis tu situación actual..."
    const words = [word("uno", 0, 0.2), word("revisamos", 0.3, 0.7), word("gratis", 0.8, 1.1)];
    expect(stripLeadingCountdown(words)).toBe(words);
  });

  it("leaves a run with no leading numbers untouched", () => {
    const words = [word("hoy", 0, 0.2), word("te", 0.3, 0.4)];
    expect(stripLeadingCountdown(words)).toBe(words);
  });

  it("drops 'va' as a cue word — this crew's own countdown convention", () => {
    // Real AZ footage: whisper.cpp transcribed "3, 2, 1, va." repeated
    // across multiple takes — "va" leaked into a final cut because the cue
    // word list only had "ya"/"accion"/etc, not this crew's actual word.
    const words = [word("tres", 0, 0.2), word("dos", 0.3, 0.5), word("uno", 0.6, 0.8), word("va", 0.9, 1.1), word("en", 1.2, 1.4)];
    expect(stripLeadingCountdown(words).map((w) => w.text)).toEqual(["en"]);
  });

  it("drops a bare director/talent cue exchange with no numbers at all", () => {
    // Real AZ footage: one voice off-camera calls "Acción", the on-camera
    // talent answers "Ya", then the real line starts — no countdown digits
    // anywhere. Previously only handled as "digits, then at most one cue
    // word", so this fell through untouched.
    const words = [word("accion", 0, 0.3), word("ya", 0.4, 0.6), word("hoy", 0.7, 0.9)];
    expect(stripLeadingCountdown(words).map((w) => w.text)).toEqual(["hoy"]);
  });

  it("drops every trailing cue word after a countdown, not just the first", () => {
    // "3, 2, 1, acción, ya" — the old code stopped after consuming one cue
    // word past the digits, leaving "ya" spoken over the real line's start.
    const words = [
      word("tres", 0, 0.2),
      word("dos", 0.3, 0.5),
      word("uno", 0.6, 0.8),
      word("accion", 0.9, 1.1),
      word("ya", 1.2, 1.4),
      word("hoy", 1.5, 1.7),
    ];
    expect(stripLeadingCountdown(words).map((w) => w.text)).toEqual(["hoy"]);
  });
});

describe("assignAssetToScript", () => {
  const scripts: ScriptVideo[] = [
    { id: "video-1", titulo: "Formalización", mostrarTitulo: true, guion: "hoy te explico como sacar tu ruc en sunarp paso a paso", necesitaRevision: false },
    { id: "video-2", titulo: "Multas", mostrarTitulo: true, guion: "esta es la multa que nadie te explica sobre tu declaracion mensual", necesitaRevision: false },
  ];

  function analysisWithText(assetPath: string, text: string): AudioAnalysis {
    const words = text.split(" ").map((t, i) => word(t, i, i + 0.9));
    return { assetPath, provider: "test", language: "es", words, silences: [] };
  }

  it("assigns a clip to the script its transcript resembles most", () => {
    const assignment = assignAssetToScript(
      analysisWithText("clip1.mp4", "hoy te explico como sacar tu ruc en sunarp"),
      scripts,
    );
    expect(assignment.scriptVideoId).toBe("video-1");
  });

  it("leaves an unrelated clip unassigned rather than forcing a weak match", () => {
    const assignment = assignAssetToScript(analysisWithText("clip3.mp4", "receta de pastel de chocolate casero"), scripts);
    expect(assignment.scriptVideoId).toBeUndefined();
  });

  it("gives a filename hint matching the script id a boost", () => {
    // Deliberately ambiguous text (touches both scripts a little) so the
    // filename hint is what decides it.
    const assignment = assignAssetToScript(
      analysisWithText("video-2-take3.mp4", "esta es la multa y tambien tu ruc"),
      scripts,
    );
    expect(assignment.scriptVideoId).toBe("video-2");
  });

  it("assigns a short clean take to the one script it belongs to, even when that script bundles several scenes into one long guion", () => {
    // Real bug, real numbers: AZ's ADS-01 guion bundles 5 scenes (~80 words)
    // into one `guion` string, and this take (ADS-01-ESCENA-03-PARTE-01) is
    // whisper.cpp's actual transcript of just ONE of those scenes — "Tú solo
    // firmas en la notaría, precio cerrado desde S/ 800" misheard as "Su
    // solo firma..." / "presos cerrado...". Symmetric Dice scored this
    // 0.058 (confirmed by temporarily reverting this function to use
    // textSimilarity instead of textContainment and re-running this exact
    // test) — under the default minScore (0.08) purely because an 80-word
    // script structurally caps how high a 10-word clip's Dice score can
    // reach, even with a clean match. The take was silently dropped from
    // the final cut despite clearly belonging there.
    const ads01: ScriptVideo = {
      id: "video-1",
      titulo: "Tu empresa en 7 días, 100% online",
      mostrarTitulo: true,
      guion:
        "¿Sigues vendiendo con tu DNI? En 7 días hábiles puedes tener tu empresa con RUC 20... sin salir de casa. " +
        "Nosotros reservamos el nombre, redactamos tu minuta, coordinamos la notaría, inscribimos en SUNARP y sacamos tu RUC y tu Clave SOL. " +
        "Tú solo firmas en la notaría. Precio cerrado desde S/ 800 con IGV, sin costos escondidos, y con tu primera asesoría contable incluida. " +
        "Soy Alexis Ramos y en AZ te atendemos nosotros, con nombre y apellido, en menos de 24 horas. " +
        "Escríbenos por WhatsApp y te decimos hoy qué tipo de empresa te conviene. Gratis.",
      necesitaRevision: false,
    };

    const assignment = assignAssetToScript(
      analysisWithText(
        "ADS-01-ESCENA-03-PARTE-01.mp4",
        "Su solo firma en la notaria, presos cerrado desde 800 soles.",
      ),
      [...scripts, ads01],
    );

    expect(assignment.scriptVideoId).toBe("video-1");
    expect(assignment.score).toBeGreaterThanOrEqual(0.08);
  });
});

describe("buildEdl", () => {
  const script: ScriptVideo = {
    id: "video-1",
    titulo: "Formalización",
    mostrarTitulo: true,
    guion: "hoy te explico como sacar tu ruc en sunarp paso a paso",
    necesitaRevision: false,
  };

  it("drops a false start and keeps the last complete take of a repeated line", () => {
    // "eh o sea" is a false start, unrelated to the script — dropped by the
    // minRunScore filter. The line is then said twice; buildEdl should keep
    // only the SECOND (chronologically later) attempt.
    const words: TranscriptWord[] = [
      word("eh", 0, 0.2),
      word("o", 0.25, 0.35),
      word("sea", 0.4, 0.6),
      // silence
      word("hoy", 3, 3.3),
      word("te", 3.35, 3.5),
      word("explico", 3.55, 4),
      // silence (false start on the real line)
      word("hoy", 6, 6.3),
      word("te", 6.35, 6.5),
      word("explico", 6.55, 7),
      word("como", 7.05, 7.3),
      word("sacar", 7.35, 7.7),
      word("tu", 7.75, 7.9),
      word("ruc", 7.95, 8.2),
    ];
    const silences = [
      { startSec: 0.6, endSec: 3 },
      { startSec: 4, endSec: 6 },
    ];
    const analysis: AudioAnalysis = { assetPath: "clip1.mp4", provider: "test", language: "es", words, silences };

    const edl = buildEdl(script, [analysis]);

    expect(edl.segmentos).toHaveLength(1);
    expect(edl.segmentos[0]!.lineaGuion).toContain("como sacar tu ruc");
    expect(edl.segmentos[0]!.archivo).toBe("clip1.mp4");
  });

  it("keeps the cleaner earlier take over a stumbled retake left in the file afterward", () => {
    // Not every shoot is "keep rolling until it's right" — some raw takes
    // nail the line first, then keep recording an unrelated extra attempt
    // that's never trimmed out. The later run here stumbles (an inserted
    // "eh" breaks two script bigrams) and drops the last word, so it scores
    // worse against the script even though it still reads as "the same
    // line" as the clean first take (duplicateThreshold is about containment
    // between the two runs, not about either one's script score).
    const words: TranscriptWord[] = [
      word("hoy", 0, 0.2),
      word("te", 0.25, 0.35),
      word("explico", 0.4, 0.8),
      word("como", 0.85, 1.1),
      word("sacar", 1.15, 1.4),
      word("tu", 1.45, 1.6),
      word("ruc", 1.65, 1.9),
      word("en", 1.95, 2.1),
      word("sunarp", 2.15, 2.5),
      word("paso", 2.55, 2.7),
      word("a", 2.75, 2.8),
      word("paso", 2.85, 3.1),
      // silence
      word("hoy", 6, 6.2),
      word("te", 6.25, 6.35),
      word("eh", 6.4, 6.6),
      word("explico", 6.65, 7.05),
      word("como", 7.1, 7.35),
      word("sacar", 7.4, 7.65),
      word("tu", 7.7, 7.85),
      word("ruc", 7.9, 8.15),
      word("en", 8.2, 8.35),
      word("sunarp", 8.4, 8.75),
    ];
    const silences = [{ startSec: 3.1, endSec: 6 }];
    const analysis: AudioAnalysis = { assetPath: "clip1.mp4", provider: "test", language: "es", words, silences };

    const edl = buildEdl(script, [analysis]);

    expect(edl.segmentos).toHaveLength(1);
    expect(edl.segmentos[0]!.lineaGuion).toBe("hoy te explico como sacar tu ruc en sunarp paso a paso");
  });

  it("cuts out a clapperboard countdown baked into the same run as the real line", () => {
    // Real AZ footage: "2, 1, acción. Soy Angel Zegarra..." transcribed as
    // one continuous run (no silence between the clapper and the line) —
    // without stripLeadingCountdown, the whole thing (including the
    // countdown) would land in the EDL as segment start.
    const words: TranscriptWord[] = [
      word("tres", 0, 0.2),
      word("dos", 0.25, 0.4),
      word("uno", 0.45, 0.6),
      word("accion", 0.65, 1),
      word("hoy", 1.05, 1.25),
      word("te", 1.3, 1.4),
      word("explico", 1.45, 1.85),
      word("como", 1.9, 2.15),
      word("sacar", 2.2, 2.45),
      word("tu", 2.5, 2.65),
      word("ruc", 2.7, 2.95),
      word("en", 3, 3.15),
      word("sunarp", 3.2, 3.55),
      word("paso", 3.6, 3.75),
      word("a", 3.8, 3.85),
      word("paso", 3.9, 4.15),
    ];
    const analysis: AudioAnalysis = { assetPath: "clip1.mp4", provider: "test", language: "es", words, silences: [] };

    const edl = buildEdl(script, [analysis]);

    expect(edl.segmentos).toHaveLength(1);
    expect(edl.segmentos[0]!.lineaGuion).toBe("hoy te explico como sacar tu ruc en sunarp paso a paso");
    expect(edl.segmentos[0]!.inicio).toBeCloseTo(1.05 - 0.2, 5); // marginSec default is 0.2
  });

  it("orders segments by their position in the script, not recording order", () => {
    // Second half of the line recorded first, first half recorded second —
    // the EDL should still read in script order.
    const words: TranscriptWord[] = [
      word("paso", 0, 0.2),
      word("a", 0.25, 0.3),
      word("paso", 0.35, 0.6),
      // silence
      word("hoy", 3, 3.2),
      word("te", 3.25, 3.4),
      word("explico", 3.45, 3.8),
    ];
    const silences = [{ startSec: 0.6, endSec: 3 }];
    const analysis: AudioAnalysis = { assetPath: "clip1.mp4", provider: "test", language: "es", words, silences };

    const edl = buildEdl(script, [analysis], { minRunScore: 0.05 });

    expect(edl.segmentos.map((s) => s.lineaGuion)).toEqual(["hoy te explico", "paso a paso"]);
  });

  it("returns an empty EDL when nothing matches the script well enough", () => {
    const analysis: AudioAnalysis = {
      assetPath: "clip1.mp4",
      provider: "test",
      language: "es",
      words: [word("receta", 0, 0.3), word("de", 0.35, 0.45), word("pastel", 0.5, 0.8)],
      silences: [],
    };
    expect(buildEdl(script, [analysis]).segmentos).toHaveLength(0);
  });

  it("carries the script's own spelling as guionTexto for a confident, full-length match", () => {
    // Whole line said cleanly, matching the full script text exactly —
    // should score high enough to trust the script's own wording.
    const words: TranscriptWord[] = "hoy te explico como sacar tu ruc en sunarp paso a paso"
      .split(" ")
      .map((w, i) => word(w, i, i + 0.9));
    const analysis: AudioAnalysis = { assetPath: "clip1.mp4", provider: "test", language: "es", words, silences: [] };

    const edl = buildEdl(script, [analysis]);

    expect(edl.segmentos).toHaveLength(1);
    expect(edl.segmentos[0]!.guionTexto).toBe("hoy te explico como sacar tu ruc en sunarp paso a paso");
  });

  it("never keeps a one-word fragment just because that word also appears in the script", () => {
    // Regression: searching a spread of window sizes around the run's own
    // length (added so a mis-transcribed acronym like "su narb" for
    // "Sunarp" doesn't throw off alignment by a couple of words) briefly
    // allowed windowSize=1, and n=2 ngrams() falls back to treating a
    // single-token array as a "unigram" for scoring short strings
    // elsewhere — at length 1 that meant "is this one word equal to that
    // one word," which handed a stray "tu" a bogus perfect score just
    // because "tu" also appears somewhere in the script. Confirmed on real
    // transcribed audio before this test was written.
    const words: TranscriptWord[] = [word("tu", 0, 0.3)];
    const analysis: AudioAnalysis = { assetPath: "clip1.mp4", provider: "test", language: "es", words, silences: [] };
    expect(buildEdl(script, [analysis]).segmentos).toHaveLength(0);
  });

  it("trims off trailing chatter once it recognizes a confident match in the earlier part of the run", () => {
    // Starts by genuinely echoing the script, then wanders off it entirely —
    // whisper.cpp routinely captures this on real takes when a talent trails
    // into unrelated chatter with no detected silence for segmentIntoRuns to
    // split on. trimRunToBestMatch should find and keep just the clean
    // "hoy te explico" prefix rather than either dropping the whole run
    // (its blended score clears minRunScore) or trusting the wandered-off
    // tail as if it were also the script's wording.
    const words: TranscriptWord[] = "hoy te explico algo distinto que no esta en el guion para nada"
      .split(" ")
      .map((w, i) => word(w, i, i + 0.9));
    const analysis: AudioAnalysis = { assetPath: "clip1.mp4", provider: "test", language: "es", words, silences: [] };

    const edl = buildEdl(script, [analysis], { minRunScore: 0.05 });

    expect(edl.segmentos).toHaveLength(1);
    expect(edl.segmentos[0]!.lineaGuion).toBe("hoy te explico");
    expect(edl.segmentos[0]!.guionTexto).toBe("hoy te explico");
  });

  it("trims leading set chatter and a countdown that isn't at the very start of the run", () => {
    // Real AZ footage, real whisper.cpp (small model) transcript for
    // ADS-01-ESCENA-03-PARTE-02: several lines of off-set chatter run
    // straight into a "3, 2, 1, va" countdown and then the actual line, all
    // as ONE continuous run (no detected silence to split on). stripLeadingCountdown
    // alone doesn't help here — the countdown isn't at position zero, the
    // chatter is. Without this trim, the whole thing (including the
    // clapperboard) ends up baked into the final cut.
    const bundledScript: ScriptVideo = {
      id: "video-1",
      titulo: "Tu empresa en 7 días, 100% online",
      mostrarTitulo: true,
      guion:
        "Tú solo firmas en la notaría. Precio cerrado desde S/ 800 con IGV, sin costos escondidos, y con tu primera asesoría contable incluida. " +
        "Soy Alexis Ramos y en AZ te atendemos nosotros, con nombre y apellido, en menos de 24 horas.",
      necesitaRevision: false,
    };
    const chatterAndLine =
      "Es verdad no pasa nada no pasa nada gracias ahi esta bien ahi esta bien si tres dos uno va " +
      "sin costos escondidos y con tu primera asesoria contable incluida";
    const words: TranscriptWord[] = chatterAndLine.split(" ").map((w, i) => word(w, i, i + 0.9));
    const analysis: AudioAnalysis = { assetPath: "ADS-01-ESCENA-03-PARTE-02.mp4", provider: "test", language: "es", words, silences: [] };

    const edl = buildEdl(bundledScript, [analysis], { minRunScore: 0.1 });

    expect(edl.segmentos).toHaveLength(1);
    expect(edl.segmentos[0]!.lineaGuion).toBe("sin costos escondidos y con tu primera asesoria contable incluida");
  });
});
