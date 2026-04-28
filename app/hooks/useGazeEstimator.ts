l
export const FACE_LANDMARKS = {
  // Olho esquerdo (do usuário — câmera frontal espelha)
  LEFT_EYE_OUTER_CORNER: 33,    // canto externo
  LEFT_EYE_INNER_CORNER: 133,   // canto interno (nariz)
  LEFT_EYE_TOP: 159,             // pálpebra superior central
  LEFT_EYE_BOTTOM: 145,          // pálpebra inferior central
  LEFT_IRIS_CENTER: 468,         // centro da íris esquerda ← chave para gaze

  // Olho direito (do usuário)
  RIGHT_EYE_OUTER_CORNER: 362,
  RIGHT_EYE_INNER_CORNER: 263,
  RIGHT_EYE_TOP: 386,
  RIGHT_EYE_BOTTOM: 374,
  RIGHT_IRIS_CENTER: 473,        // centro da íris direita ← chave para gaze
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

// [GAZE] Ponto landmark normalizado que o MediaPipe retorna (0–1 no espaço da imagem)
export type NormalizedLandmark = {
  x: number
  y: number
  z: number
}

// [GAZE] Classificação de zona 3x3
export type GazeHorizontal = 'left' | 'center' | 'right' | 'unknown'
export type GazeVertical = 'up' | 'middle' | 'down' | 'unknown'
export type GazeZone =
  | 'top-left'    | 'top-center'    | 'top-right'
  | 'mid-left'    | 'mid-center'    | 'mid-right'
  | 'bot-left'    | 'bot-center'    | 'bot-right'
  | 'unknown'

// [GAZE] Resultado completo de estimativa de olhar
export type GazeResult = {
  horizontal: GazeHorizontal
  vertical: GazeVertical
  zone: GazeZone

  // Posição normalizada da íris (média dos dois olhos)
  // 0.0 = completamente à esquerda/cima, 1.0 = completamente à direita/baixo
  irisNormX: number
  irisNormY: number

  // Confiança baseada no tamanho aparente dos olhos (0–1)
  // Olhos pequenos = rosto lateral ou muito longe = estimativa menos confiável
  confidence: number

  // Dados brutos por olho, úteis para debug e calibração
  leftEyeNormX: number
  leftEyeNormY: number
  rightEyeNormX: number
  rightEyeNormY: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Thresholds de classificação (ajustáveis por calibração)
// ─────────────────────────────────────────────────────────────────────────────
export type GazeThresholds = {
  hLeft: number    // abaixo = olhando esquerda   (padrão: 0.40)
  hRight: number   // acima  = olhando direita    (padrão: 0.60)
  vUp: number      // abaixo = olhando cima       (padrão: 0.38)
  vDown: number    // acima  = olhando baixo      (padrão: 0.62)
}

export const DEFAULT_THRESHOLDS: GazeThresholds = {
  hLeft: 0.40,
  hRight: 0.60,
  vUp: 0.38,
  vDown: 0.62,
}

// ─────────────────────────────────────────────────────────────────────────────
// Lógica interna
// ─────────────────────────────────────────────────────────────────────────────

/**
 * [GAZE] Calcula posição normalizada da íris dentro da órbita ocular.
 *
 * Retorna normX e normY onde:
 *   normX ∈ [0,1]: 0 = canto externo, 1 = canto interno (nariz)
 *   normY ∈ [0,1]: 0 = pálpebra superior, 1 = pálpebra inferior
 *
 * eyeWidth é retornado para cálculo de confiança (olhos maiores = face frontal = mais confiável)
 */
function normalizeIrisPosition(
  iris: NormalizedLandmark,
  outerCorner: NormalizedLandmark,
  innerCorner: NormalizedLandmark,
  topLid: NormalizedLandmark,
  bottomLid: NormalizedLandmark,
): { normX: number; normY: number; eyeWidth: number; eyeHeight: number } {
  const eyeWidth = Math.abs(innerCorner.x - outerCorner.x)
  const eyeHeight = Math.abs(bottomLid.y - topLid.y)

  // Proteção contra divisão por zero em frames onde o rosto está muito lateral
  if (eyeWidth < 0.002 || eyeHeight < 0.002) {
    return { normX: 0.5, normY: 0.5, eyeWidth: 0, eyeHeight: 0 }
  }

  const rawNormX = (iris.x - outerCorner.x) / (innerCorner.x - outerCorner.x)
  const rawNormY = (iris.y - topLid.y) / (bottomLid.y - topLid.y)

  return {
    normX: Math.max(0, Math.min(1, rawNormX)),
    normY: Math.max(0, Math.min(1, rawNormY)),
    eyeWidth,
    eyeHeight,
  }
}

/**
 * [GAZE] Classifica zona a partir de valores normalizados e thresholds
 */
function classifyZone(
  irisNormX: number,
  irisNormY: number,
  thresholds: GazeThresholds,
): { horizontal: GazeHorizontal; vertical: GazeVertical; zone: GazeZone } {
  let horizontal: GazeHorizontal
  if (irisNormX < thresholds.hLeft) horizontal = 'left'
  else if (irisNormX > thresholds.hRight) horizontal = 'right'
  else horizontal = 'center'

  let vertical: GazeVertical
  if (irisNormY < thresholds.vUp) vertical = 'up'
  else if (irisNormY > thresholds.vDown) vertical = 'down'
  else vertical = 'middle'

  const vPart = vertical === 'up' ? 'top' : vertical === 'down' ? 'bot' : 'mid'
  const zone = `${vPart}-${horizontal}` as GazeZone

  return { horizontal, vertical, zone }
}

// ─────────────────────────────────────────────────────────────────────────────
// Função principal exportada
// ─────────────────────────────────────────────────────────────────────────────

/**
 * [GAZE] Estima a zona de olhar a partir dos 478 landmarks do MediaPipe FaceLandmarker.
 *
 * Entrada: array de NormalizedLandmark (coordenadas 0–1 relativas ao frame da câmera)
 * Saída:   GazeResult com zona classificada, valores normalizados e confiança
 *
 * Uso:
 *   const gaze = estimateGazeZone(result.faceLandmarks[0], DEFAULT_THRESHOLDS)
 */
export function estimateGazeZone(
  landmarks: NormalizedLandmark[],
  thresholds: GazeThresholds = DEFAULT_THRESHOLDS,
): GazeResult {
  const unknown: GazeResult = {
    horizontal: 'unknown', vertical: 'unknown', zone: 'unknown',
    irisNormX: 0.5, irisNormY: 0.5, confidence: 0,
    leftEyeNormX: 0.5, leftEyeNormY: 0.5,
    rightEyeNormX: 0.5, rightEyeNormY: 0.5,
  }

  // Modelo 478-pt é necessário para os índices da íris (468+)
  if (!landmarks || landmarks.length < 478) return unknown

  // --- Normaliza posição da íris no olho ESQUERDO ---
  const leftNorm = normalizeIrisPosition(
    landmarks[FACE_LANDMARKS.LEFT_IRIS_CENTER],
    landmarks[FACE_LANDMARKS.LEFT_EYE_OUTER_CORNER],
    landmarks[FACE_LANDMARKS.LEFT_EYE_INNER_CORNER],
    landmarks[FACE_LANDMARKS.LEFT_EYE_TOP],
    landmarks[FACE_LANDMARKS.LEFT_EYE_BOTTOM],
  )

  // --- Normaliza posição da íris no olho DIREITO ---
  // Nota: para o olho direito, inner/outer são invertidos em relação ao eixo X
  // (o canto "inner" fica à esquerda na imagem espelhada)
  const rightNorm = normalizeIrisPosition(
    landmarks[FACE_LANDMARKS.RIGHT_IRIS_CENTER],
    landmarks[FACE_LANDMARKS.RIGHT_EYE_INNER_CORNER], // invertido intencionalmente
    landmarks[FACE_LANDMARKS.RIGHT_EYE_OUTER_CORNER], // invertido intencionalmente
    landmarks[FACE_LANDMARKS.RIGHT_EYE_TOP],
    landmarks[FACE_LANDMARKS.RIGHT_EYE_BOTTOM],
  )

  // Confiança: quanto maior o olho aparente na imagem, mais frontal está o rosto
  // Olhos < 0.02 de largura normalizada = face muito lateral ou distante
  const avgEyeWidth = (leftNorm.eyeWidth + rightNorm.eyeWidth) / 2
  const confidence = Math.min(1, avgEyeWidth / 0.035)

  if (confidence < 0.1) return { ...unknown, confidence }

  // Média dos dois olhos para estabilidade
  const irisNormX = (leftNorm.normX + rightNorm.normX) / 2
  const irisNormY = (leftNorm.normY + rightNorm.normY) / 2

  const { horizontal, vertical, zone } = classifyZone(irisNormX, irisNormY, thresholds)

  return {
    horizontal,
    vertical,
    zone,
    irisNormX,
    irisNormY,
    confidence,
    leftEyeNormX: leftNorm.normX,
    leftEyeNormY: leftNorm.normY,
    rightEyeNormX: rightNorm.normX,
    rightEyeNormY: rightNorm.normY,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// [GAZE] Utilitário: suavização temporal (evita flickering entre zonas)
// Mantém a última zona por N frames antes de confirmar troca
// ─────────────────────────────────────────────────────────────────────────────
export function createGazeStabilizer(requiredConsistentFrames = 4) {
  let pendingZone: GazeZone = 'unknown'
  let pendingCount = 0
  let stableZone: GazeZone = 'unknown'

  return function stabilize(currentZone: GazeZone): GazeZone {
    if (currentZone === pendingZone) {
      pendingCount++
    } else {
      pendingZone = currentZone
      pendingCount = 1
    }

    if (pendingCount >= requiredConsistentFrames) {
      stableZone = pendingZone
    }

    return stableZone
  }
}
