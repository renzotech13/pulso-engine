---
name: historias-video-ia
description: Cómo estructurar y producir los videos de "historias y reflexiones" de Rocío Escobar (y cualquier cuenta con la misma fórmula) a partir de un guion — TODO en video (Kling), escenas con diálogo de personajes con su propia voz, voz en off de la narradora, tramos de la narradora a cámara con HeyGen y un final impactante (personaje a cámara + zoom al rostro con Seedance). Usar siempre que el usuario envíe un guion de historia/reflexión y pida armar el video, o mencione escenas, tomas, "la de la compañera", foto parlante o "voz en off".
---

# Videos de historias y reflexiones (estructura obligada)

Regla base del usuario: **nada estático. Todo es video.** Prohibido rellenar con imágenes fijas con zoom/paneo (se probó y se rechazó: "nada estático, todo debe ser video"). Cada toma es un clip de video generado a partir de una imagen inicial.

Implementación de referencia: `/Users/renzo/Rocio Inmobiliaria/historia-herencia/` (`montar2.py` arma la línea de tiempo, `armar.py` en `../organicos/` tiene alineado de palabras y subtítulos). Caso resuelto: guion "Heredarnos a nosotros mismos" (24-09-2026). Memoria: `rocio-historia-herencia`, `rocio-inmobiliaria-organicos`.

## Los 4 tipos de toma
| Tipo | Qué es | Voz | Cómo se genera |
|---|---|---|---|
| **A. Voz en off sobre tomas** | Recuerdos/acciones que Rocío cuenta | Rocío (VoiceStudio, perfil clonado 54abc26f) | Imagen inicial → Kling 3 Pro **sin audio** (3–6 s) |
| **B. Escena con diálogo** | Un personaje habla con otro (la compañera, el papá…) | La **voz del propio personaje, generada dentro del clip** (Kling con `generate_audio: true`; la frase va entre comillas en el prompt) | 6–8 s por clip; tantas como pida el guion (idea: 2 clips de 8 s); el que escucha NO debe gesticular ni mover los labios |
| **C. Narradora a cámara** | Rocío hoy contando la historia (foto parlante) | Rocío (tramo del audio de VoiceStudio) | Imagen de Rocío hoy → look nuevo en HeyGen (`create_photo_avatar` en el grupo con consentimiento) → `create_video_from_avatar` con el tramo de audio |
| **D. Final** | El personaje mira a cámara y dice las últimas frases; luego zoom al rostro con la última palabra | Personaje en escena (Kling con audio) y última palabra con voz de VoiceStudio empalmada | Kling; luego **Seedance 2.0 (face)** usando como cuadro inicial el ÚLTIMO fotograma del clip anterior, cámara hace zoom al rostro en primer plano, dice la palabra final |

## Línea de tiempo tipo
1. **Abre con voz en off** (Rocío) sobre tomas tipo A. La primera escena con diálogo (tipo B) entra recién hacia el segundo ~20-25 (no antes; el usuario lo pidió así). Si el guion pone el diálogo antes, avisar y proponer cómo cuadrarlo.
2. Escena de diálogo (B) con la voz del personaje → otra escena con voz → vuelve la voz en off.
3. En el medio, **tomas C**: Rocío narradora a cámara (cambia de lugar/vestuario entre tomas para no repetir).
4. **Cierre:** se vuelve a la historia. El personaje (p. ej. la joven que mira a cámara) dice las frases finales con Kling ("Todos recibimos una historia diferente. Lo importante es qué decides construir con la tuya."), y en la misma escena **Seedance 2.0 face** hace el zoom al rostro para la última palabra ("Obsérvate."), empalmando audio de VoiceStudio para que cuadre, con un final más impactante.

## Cómo estructurar un guion nuevo (procedimiento)
1. Cortar el guion en frases y clasificar cada una: cita de otro personaje → **B**; recuerdo/acción → **A**; reflexión de la narradora → **C** o voz en off; frase final → **D**.
2. Cualquier texto NUEVO (réplicas de personajes, frases de reacción de Rocío) **requiere aprobación** del usuario antes de generar (precedente: "Yo me quedé callada. No entendía cómo alguien podía no querer algo que yo habría dado todo por tener.").
3. Presentar la propuesta como tabla (escena, tipo, duración, quién habla, texto, imagen inicial) para aprobar. Probar primero con 2 o 3 escenas de dos personas y el resto voz en off; ajustar y recién luego escalar.
4. Generar por tandas de 4-5 clips, siempre con `estimate_only` primero y revisando parecido de Rocío antes de seguir.

## Pipeline y herramientas (todo verificado)
- **Imágenes iniciales:** ElevenLabs flows, `creative_add_flow_node` (image-generation, gpt-image-2, `aspect_ratio 9:16`, `resolution 2K`, `quality medium`) conectado a 2 nodos de referencia (fotos (295) vestido azul y (220) chaleco beige de `FOTOS PROFESIONALES ` — la carpeta lleva un espacio final — subidas por el usuario con `creative_upload_flow_reference`, no se pueden subir desde código). ~737 créditos con refs, ~267 sin refs. Prompts: "same fuller, curvy body build as in the reference photos" (si no sale delgada); "clearly young, about 20" para la Rocío universitaria; "PROFILE"/"no mirar a cámara" cuando corresponda. Si el aspecto queda 16:9 el video sale mal: fijarlo en `model_parameters`.
- **Video:** Kling 3 Pro (`kling-3-pro`) con `creative_add_flow_node` (video-generation) y `connect_from` el nodo de la imagen (puerto `start_frame`); `duration_secs` 3–15, `aspect_ratio 9:16`, `resolution 1080p`, `generate_audio` true solo en diálogos. Costo real: ~680 créditos/s sin audio (≈0,12 US$/s), ~1.000/s con audio; un clip de 4 s ≈ 2.700 (0,49 US$). Veo 3.1 cuesta 2,4× más para el mismo diálogo y no mejoró el texto: usar Kling. Seedance ≈ 7.300/clip estimado (para el zoom final).
- **Voces:** Rocío = VoiceStudio local (`POST 127.0.0.1:3900/generate`, `profile_id=54abc26f`, `language=Spanish`; 285 palabras ≈ 7 min; abrir VoiceStudio y mantener la Mac despierta con `caffeinate`). Personajes = audio nativo de Kling. No usar ElevenLabs TTS (decisión del usuario).
- **Narradora a cámara:** subir imagen y audio a HeyGen (`create_asset_upload` + PUT + `complete_asset_upload`; en zsh cada `-H` entre comillas o da 403), look nuevo con `create_photo_avatar` (`avatarGroupId 8542db5615594194bc5d0c66cb9e6c07`), video con Avatar IV 9:16 cover, `expressiveness medium`; ~1,4 créditos/s. Los dos looks del digital twin verticales: blazer azul y blazer café (escenas 1 y 15 con el twin, pendientes de decidir).
- **Montaje:** alinear palabras con whisper (`armar.palabras_whisper`, tolera alucinaciones), armar el audio por piezas (A voz en off / B voz del personaje del clip / C reacción / D resto), recortar los clips a la duración exacta de cada tramo, subtítulos Black centrados con highlight dorado #E3B341 y marca `@rocioescobarq` (`rocio-subs-black.json`), loudnorm -14.
- **Descargas de ElevenLabs:** URLs firmadas de 2 h; `curl -sL` y comprobar que el archivo pese más de unos KB (si pesa ~900 bytes es un XML de error: firma mal copiada, pedir la URL de nuevo).

## Trampas conocidas
- En clips de diálogo con dos personas, el que escucha también gesticula/mueve la boca: pedir explícitamente "stays silent, no lip movement".
- Kling con imagen horizontal sale recortado/blando: todas las imágenes iniciales en 9:16.
- Los conectores (ElevenLabs, HeyGen) son de la cuenta de Claude del usuario: al cambiar de cuenta se pierden flows y referencias; guardar siempre todo en disco.
- Magnific (5 créditos) y Everygen (0) no sirven para generar; sí para stock (ver reglas de stock en memoria).
- Por verificar: el modelo "Seedance 2.0 face" que nombró el usuario (en ElevenLabs aparecen `bytedance-seedance-v2` y `-v2.5`; confirmar si existe la variante face o cómo se activa antes de gastar).
