import { Composition } from "remotion";
import { Reel, REEL_DURATION_FRAMES, REEL_FPS, REEL_SIZE, reelSchema } from "./compositions/Reel.js";
import {
  STORY_PROMO_DURATION_FRAMES,
  STORY_PROMO_FPS,
  STORY_PROMO_SIZE,
  StoryPromo,
  storyPromoSchema,
} from "./compositions/StoryPromo.js";
import { Overlay, overlaySchema } from "./compositions/Overlay.js";

const DEFAULT_BRAND = {
  logoUrl: null,
  colorPrimary: "#7C6FF0",
  colorSecondary: "#FF8B5E",
  tenantName: "Demo",
};

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="reel"
        component={Reel}
        durationInFrames={REEL_DURATION_FRAMES}
        fps={REEL_FPS}
        width={REEL_SIZE.width}
        height={REEL_SIZE.height}
        schema={reelSchema}
        defaultProps={{ brand: DEFAULT_BRAND, headline: "20% en masajes" }}
      />
      <Composition
        id="story-promo"
        component={StoryPromo}
        durationInFrames={STORY_PROMO_DURATION_FRAMES}
        fps={STORY_PROMO_FPS}
        width={STORY_PROMO_SIZE.width}
        height={STORY_PROMO_SIZE.height}
        schema={storyPromoSchema}
        defaultProps={{ brand: DEFAULT_BRAND, message: "20% en masajes" }}
      />
      <Composition
        id="overlay"
        component={Overlay}
        schema={overlaySchema}
        // Fixed values here are placeholders for the Studio preview only —
        // calculateMetadata below overrides them for every real render with
        // whatever this specific project's video actually measures.
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          durationSec: 5,
          fps: 30,
          width: 1080,
          height: 1920,
          fuente: { familia: "system-ui", peso: 700 },
          subtitulos: [],
          subtituloEstilo: {
            tamano: 64,
            color: "#FFFFFF",
            colorPalabraActiva: "#FFD400",
            posicion: "inferior",
            margenSeguroInferiorPx: 220,
            maxCaracteresPorLinea: 24,
            maxLineas: 2,
            mayusculas: true,
            resaltarPalabraActiva: true,
            animacion: "pop",
            lineaUnicaFluida: false,
          },
        }}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.max(1, Math.round(props.durationSec * props.fps)),
          fps: props.fps,
          width: props.width,
          height: props.height,
        })}
      />
    </>
  );
}
