// Isolated Remotion root for the one-off Movistar price-card render — NOT
// the shared Root.tsx (that one feeds the multi-tenant registry and every
// other brand). See PrecioCard.tsx's own header comment for why this stays
// off to the side.
import { Composition } from "remotion";
import { PrecioCard, precioCardSchema } from "./compositions/PrecioCard.js";
import { PrecioCardPlan, precioCardPlanSchema } from "./compositions/PrecioCardPlan.js";
import { FeatureCards, featureCardsSchema } from "./compositions/FeatureCards.js";
import { ArrowDown, arrowDownSchema } from "./compositions/ArrowDown.js";
import { PillStack, pillStackSchema } from "./compositions/PillStack.js";
import { WhatsappPill, whatsappPillSchema } from "./compositions/WhatsappPill.js";
import { TituloPill, tituloPillSchema } from "./compositions/TituloPill.js";
import { TituloOlas, tituloOlasSchema } from "./compositions/TituloOlas.js";
import { CtaOla, ctaOlaSchema } from "./compositions/CtaOla.js";
import { TituloOlaPill, tituloOlaPillSchema } from "./compositions/TituloOlaPill.js";

export function PrecioCardRoot() {
  return (
    <>
    <Composition
      id="precio-card"
      component={PrecioCard}
      schema={precioCardSchema}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{
        durationSec: 5,
        fps: 30,
        width: 1080,
        height: 1920,
        etiquetaIzquierda: "A solo",
        valorIzquierda: "S/ 39.90",
        valorDerecha: "225 GB",
        etiquetaDerecha: "en alta velocidad",
        colorFondoInicio: "#3E9142",
        colorFondoFin: "#1B5E20",
        colorTexto: "#FFFFFF",
        colorAcento: "#A6E89E",
        posicionYFrac: 0.82,
        anchoMaximoFrac: 0.9,
      }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, Math.round(props.durationSec * props.fps)),
        fps: props.fps,
        width: props.width,
        height: props.height,
      })}
    />
    <Composition
      id="precio-card-plan"
      component={PrecioCardPlan}
      schema={precioCardPlanSchema}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{
        durationSec: 5,
        fps: 30,
        width: 1080,
        height: 1920,
        etiquetaIzquierda: "Plan desde",
        valorIzquierda: "S/ 39.90",
        iconoDerecha: "infinito" as const,
        textoDerecha: "Internet | ilimitado",
        colorFondoInicio: "#4FA8E8",
        colorFondoFin: "#0D5DA6",
        colorTexto: "#FFFFFF",
        posicionYFrac: 0.82,
        anchoMaximoFrac: 0.9,
      }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, Math.round(props.durationSec * props.fps)),
        fps: props.fps,
        width: props.width,
        height: props.height,
      })}
    />
    <Composition
      id="feature-cards"
      component={FeatureCards}
      schema={featureCardsSchema}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{
        durationSec: 5,
        fps: 30,
        width: 1080,
        height: 1920,
        items: [
          { icono: "chip" as const, texto: "Conserva | tu mismo número" },
          { icono: "casa" as const, texto: "Recibe tu | chip gratis | en casa" },
          { icono: "delivery" as const, texto: "Delivery gratis | en menos de | 3 horas" },
          { icono: "cobertura" as const, texto: "Cobertura | en todo el Perú" },
        ],
        colorTarjeta: "#FFFFFF",
        colorTexto: "#0F62D6",
        colorIcono: "#0F62D6",
        posicionYFrac: 0.5,
        anchoMaximoFrac: 0.86,
        tamanoTexto: 36,
        alturaTarjeta: 120,
        radioTarjeta: 32,
        separacionPx: 20,
        columnas: 1,
        separacionColPx: 20,
        margenDerechoGridPx: 0,
        paddingVerticalPx: 0,
        desplazamientoFilaSuperiorPx: 0,
      }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, Math.round(props.durationSec * props.fps)),
        fps: props.fps,
        width: props.width,
        height: props.height,
      })}
    />
    <Composition
      id="arrow-down"
      component={ArrowDown}
      schema={arrowDownSchema}
      durationInFrames={66}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{
        durationSec: 2.2,
        fps: 30,
        width: 1080,
        height: 1920,
        color: "#3EC6FF",
        posicionXFrac: 0.5,
        posicionYFrac: 0.5,
        tamano: 90,
        cantidadChevrones: 3,
        velocidadSeg: 1.1,
      }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, Math.round(props.durationSec * props.fps)),
        fps: props.fps,
        width: props.width,
        height: props.height,
      })}
    />
    <Composition
      id="pill-stack"
      component={PillStack}
      schema={pillStackSchema}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{
        durationSec: 5,
        fps: 30,
        width: 1080,
        height: 1920,
        posicionYFrac: 0.5,
        anchoMaximoFrac: 0.85,
        separacionPx: 18,
        colorAcento: "#3EC6FF",
        colorCtaFondo: "#FFFFFF",
        colorCtaTexto: "#0E1F4D",
        textoCta: "Cámbiate a Movistar",
        colorWifiFondo: "#0D5DA6",
        colorWifiTexto: "#FFFFFF",
        colorWifiAcento: "#3EC6FF",
        textoWifiPrincipal: "Internet",
        textoWifiSecundario: "ilimitado",
        colorPrecioFondo: "#FFFFFF",
        colorPrecioTexto: "#0E1F4D",
        valorPrecio: "S/ 39.90",
        etiquetaPrecio: "Solo otras líneas",
      }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, Math.round(props.durationSec * props.fps)),
        fps: props.fps,
        width: props.width,
        height: props.height,
      })}
    />
    <Composition
      id="whatsapp-pill"
      component={WhatsappPill}
      schema={whatsappPillSchema}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ durationSec: 5, fps: 30, width: 1080, height: 1920, texto1: "ESCRÍBENOS", texto2: "POR WHATSAPP", posicionYFrac: 0.8, anchoPx: 760, alturaPx: 190, colorVerdeInicio: "#46B24F", colorVerdeFin: "#1B7A2B", colorTexto1: "#FFFFFF", colorTexto2: "#C8F03A", colorBrillo: "#B6FF3C", retrasoFlechaSeg: 0.6, pulsoSeg: 1.1 }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, Math.round(props.durationSec * props.fps)),
        fps: props.fps,
        width: props.width,
        height: props.height,
      })}
    />
    <Composition
      id="titulo-pill"
      component={TituloPill}
      schema={tituloPillSchema}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ durationSec: 5, fps: 30, width: 1080, height: 1920, texto1: "¿Eres Bitel y quieres", texto2: "internet ilimitado?", posicionYFrac: 0.3, desplazamientoXPx: 0, colorFondo: "#2050B9", colorTexto1: "#FFFFFF", colorTexto2: "#4FE3D6", colorChispas: "#4FE3D6", tamano1: 64, tamano2: 84, chispaArribaPct: 34, chispaAbajoPct: 56 }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, Math.round(props.durationSec * props.fps)),
        fps: props.fps,
        width: props.width,
        height: props.height,
      })}
    />
    <Composition
      id="titulo-olas"
      component={TituloOlas}
      schema={tituloOlasSchema}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ durationSec: 5, fps: 30, width: 1080, height: 1920, linea1: "SEÑAL Y DATOS", linea2: "ILIMITADOS", linea3: "EN TODO EL PERÚ", posicionYFrac: 0.22, colorLinea1: "#FFFFFF", colorLinea2: "#5FD9F5", colorLinea3: "#FFFFFF", tamano1: 112, tamano2: 170, tamano3: 70, amplitudPx: 7, cicloSeg: 6, escalonSeg: 0.04 }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, Math.round(props.durationSec * props.fps)),
        fps: props.fps,
        width: props.width,
        height: props.height,
      })}
    />
    <Composition
      id="titulo-ola-pill"
      component={TituloOlaPill}
      schema={tituloOlaPillSchema}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ durationSec: 5, fps: 30, width: 1080, height: 1920, texto1: "¿PAGAS MÁS DE", texto2: "S/ 50 EN CLARO O ENTEL?", posicionYFrac: 0.15, colorTexto1: "#0A1E3C", colorTexto2: "#FFFFFF", colorPill: "#3B86E6", tamano1: 110, tamano2: 78, amplitudPx: 7, cicloSeg: 6, escalonSeg: 0.04, entradaPillSeg: 0.7 }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, Math.round(props.durationSec * props.fps)),
        fps: props.fps,
        width: props.width,
        height: props.height,
      })}
    />
    <Composition
      id="cta-ola"
      component={CtaOla}
      schema={ctaOlaSchema}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ durationSec: 5, fps: 30, width: 1080, height: 1920, linea1: "ESCRÍBENOS", linea2: "POR WHATSAPP", posicionYFrac: 0.8, colorLinea1: "#FFFFFF", colorLinea2: "#5FD9F5", tamano1: 96, tamano2: 112, amplitudPx: 7, cicloSeg: 6, escalonSeg: 0.04, colorFlecha: "#3EC6FF", tamanoFlecha: 90, retrasoFlechaSeg: 1.1, distanciaFlechaPx: 210 }}
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
