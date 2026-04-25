// components/GazeOverlay.tsx
// [GAZE] Novo componente — exibe grade 3x3 e destaca zona de olhar atual
// Substitui os simples eyeDots do overlay original

import React, { useEffect, useRef } from 'react'
import { Animated, Dimensions, StyleSheet, Text, View } from 'react-native'
import type { GazeResult, GazeZone } from '../hooks/useGazeEstimator'

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window')

// ─────────────────────────────────────────────────────────────────────────────
// Configuração da grade 3x3
// ─────────────────────────────────────────────────────────────────────────────

// [GAZE] Células da grade — ordem: top-left → bot-right
const GRID_ZONES: GazeZone[] = [
  'top-left',  'top-center',  'top-right',
  'mid-left',  'mid-center',  'mid-right',
  'bot-left',  'bot-center',  'bot-right',
]

// [GAZE] Labels amigáveis para debug
const ZONE_LABELS: Record<GazeZone, string> = {
  'top-left':   '↖',  'top-center':  '↑',  'top-right':  '↗',
  'mid-left':   '←',  'mid-center':  '·',  'mid-right':  '→',
  'bot-left':   '↙',  'bot-center':  '↓',  'bot-right':  '↘',
  'unknown':    '?',
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  gazeResult: GazeResult | null

  // controla visibilidade da grade (pode ser toggled pelo usuário)
  showGrid?: boolean

  // mostra dados numéricos brutos (para debug/calibração)
  showDebug?: boolean

  // ponto de íris em coordenadas de tela (para desenhar dot sobre o olho)
  // coordenadas em pixels, vindas dos landmarks × dimensões da tela
  leftIrisScreenX?: number
  leftIrisScreenY?: number
  rightIrisScreenX?: number
  rightIrisScreenY?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Célula individual da grade
// ─────────────────────────────────────────────────────────────────────────────

type CellProps = {
  zone: GazeZone
  isActive: boolean
  // [GAZE] zona de teste atual (durante fluxo de calibração)
  isTarget?: boolean
}

function GridCell({ zone, isActive, isTarget }: CellProps) {
  // Animação de pulso na célula ativa
  const pulseAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (isActive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 300, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        ])
      ).start()
    } else {
      pulseAnim.stopAnimation()
      pulseAnim.setValue(1)
    }
  }, [isActive, pulseAnim])

  return (
    <Animated.View
      style={[
        styles.cell,
        isTarget && styles.cellTarget,
        isActive && styles.cellActive,
        { transform: [{ scale: isActive ? pulseAnim : 1 }] },
      ]}
    >
      <Text style={[styles.cellLabel, isActive && styles.cellLabelActive]}>
        {ZONE_LABELS[zone]}
      </Text>
    </Animated.View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────

export default function GazeOverlay({
  gazeResult,
  showGrid = true,
  showDebug = false,
  leftIrisScreenX,
  leftIrisScreenY,
  rightIrisScreenX,
  rightIrisScreenY,
}: Props) {
  const activeZone = gazeResult?.zone ?? 'unknown'
  const confidence = gazeResult?.confidence ?? 0

  return (
    <>
      {/* ── Grade 3×3 posicionada na metade superior da tela ── */}
      {showGrid && (
        <View style={styles.gridContainer}>
          {GRID_ZONES.map((zone) => (
            <GridCell
              key={zone}
              zone={zone}
              isActive={zone === activeZone && confidence > 0.3}
            />
          ))}
        </View>
      )}

      {/* ── Dot azul sobre íris esquerda ── */}
      {/* [GAZE] Substitui o dot de LEFT_EYE do MLKit pelo ponto real da íris */}
      {leftIrisScreenX !== undefined && leftIrisScreenY !== undefined && (
        <View
          style={[
            styles.irisDot,
            {
              backgroundColor: 'rgba(100, 200, 255, 0.9)',
              left: leftIrisScreenX - 6,
              top: leftIrisScreenY - 6,
            },
          ]}
        />
      )}

      {/* ── Dot vermelho sobre íris direita ── */}
      {rightIrisScreenX !== undefined && rightIrisScreenY !== undefined && (
        <View
          style={[
            styles.irisDot,
            {
              backgroundColor: 'rgba(255, 100, 100, 0.9)',
              left: rightIrisScreenX - 6,
              top: rightIrisScreenY - 6,
            },
          ]}
        />
      )}

      {/* ── Painel de status inferior ── */}
      {/* [GAZE] Substitui o overlay de texto original com info de zona */}
      <View style={styles.statusPanel}>
        {gazeResult && gazeResult.zone !== 'unknown' ? (
          <>
            <Text style={styles.statusZone}>
              {ZONE_LABELS[activeZone]}  {activeZone.replace('-', ' ').toUpperCase()}
            </Text>
            <Text style={styles.statusConf}>
              conf: {(confidence * 100).toFixed(0)}%
            </Text>

            {/* Debug: valores brutos da íris normalizada */}
            {showDebug && (
              <>
                <Text style={styles.debugText}>
                  iris X: {gazeResult.irisNormX.toFixed(3)}  Y: {gazeResult.irisNormY.toFixed(3)}
                </Text>
                <Text style={styles.debugText}>
                  L({gazeResult.leftEyeNormX.toFixed(2)},{gazeResult.leftEyeNormY.toFixed(2)})
                  {' '}R({gazeResult.rightEyeNormX.toFixed(2)},{gazeResult.rightEyeNormY.toFixed(2)})
                </Text>
              </>
            )}
          </>
        ) : (
          <Text style={styles.statusSearching}>
            {gazeResult?.confidence === 0 ? 'Rosto não detectado...' : 'Calculando...'}
          </Text>
        )}
      </View>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const GRID_SIZE = SCREEN_WIDTH * 0.75  // grade ocupa 75% da largura da tela
const CELL_SIZE = GRID_SIZE / 3

const styles = StyleSheet.create({
  // [GAZE] Grade 3×3 centralizada
  gridContainer: {
    position: 'absolute',
    top: SCREEN_HEIGHT * 0.12,
    left: (SCREEN_WIDTH - GRID_SIZE) / 2,
    width: GRID_SIZE,
    height: GRID_SIZE,
    flexDirection: 'row',
    flexWrap: 'wrap',
    zIndex: 10,
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  // [GAZE] Célula alvo durante calibração
  cellTarget: {
    borderColor: 'rgba(255, 220, 50, 0.8)',
    borderWidth: 2,
    backgroundColor: 'rgba(255, 220, 50, 0.15)',
  },
  // [GAZE] Célula ativa (zona onde o usuário está olhando)
  cellActive: {
    backgroundColor: 'rgba(0, 200, 120, 0.4)',
    borderColor: 'rgba(0, 255, 150, 0.9)',
    borderWidth: 2,
  },
  cellLabel: {
    fontSize: 24,
    color: 'rgba(255,255,255,0.4)',
  },
  cellLabelActive: {
    color: 'rgba(0, 255, 150, 1)',
    fontSize: 28,
  },

  // [GAZE] Dot de íris — mais preciso que o dot de olho do MLKit
  irisDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'white',
    zIndex: 999,
  },

  // [GAZE] Painel de status inferior
  statusPanel: {
    position: 'absolute',
    bottom: 130,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 16,
    alignItems: 'center',
    minWidth: 220,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  statusZone: {
    color: '#00ff96',
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    letterSpacing: 2,
  },
  statusConf: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  debugText: {
    color: '#adf',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 3,
  },
  statusSearching: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    fontFamily: 'monospace',
  },
})
