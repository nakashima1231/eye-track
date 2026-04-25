// app/index.tsx
// [GAZE] Adaptação do app de face tracking para gaze tracking com MediaPipe
//
// O que mudou em relação ao original:
//   REMOVIDO:  react-native-vision-camera-face-detector (MLKit, só 5 landmarks)
//   ADICIONADO: react-native-mediapipe useFaceLandmarkDetection (478 landmarks + íris)
//   ADAPTADO:  FaceData → GazeData (inclui posição da íris + resultado de zona)
//   REMOVIDO:  useFrameProcessor + runAsync + Worklets (o hook do mediapipe já gerencia isso)
//   MANTIDO:   useCameraDevice, useCameraPermission
//   MANTIDO:   AsyncStorage para persistência
//   MANTIDO:   overlay absoluto sobre câmera
//   SUBSTITUÍDO: galeria de fotos → log de sessões de gaze
//   SUBSTITUÍDO: painel de offsets → painel de calibração de thresholds

import AsyncStorage from '@react-native-async-storage/async-storage'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
// [GAZE] useCameraDevice e useCameraPermission mantidos
// [GAZE] REMOVIDOS: runAsync, useFrameProcessor — o hook do mediapipe retorna
//        seu próprio frameProcessor pronto, não criamos o nosso manualmente
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera'
// [GAZE] REMOVIDO: Worklets — não precisamos mais da bridge manual JS↔Worklet

// [GAZE] Correto: hook é useFaceLandmarkDetection, não useFaceLandmarker
// API: useFaceLandmarkDetection(callbacks, runningMode, model, options)
// O hook retorna { frameProcessor, cameraViewLayoutChangeHandler, ... }
// Docs: https://cdiddy77.github.io/react-native-mediapipe/docs/api_pages/face-landmark-detection
import { Delegate, DetectionError, RunningMode, useFaceLandmarkDetection } from 'react-native-mediapipe'

// [GAZE] Novo: componentes e lógica de gaze
import GazeOverlay from '../components/GazeOverlay'
import type { GazeSample, GazeSession } from '../components/GazeSessionLogger'
import GazeSessionLogger from '../components/GazeSessionLogger'
import {
  DEFAULT_THRESHOLDS,
  GazeThresholds,
  GazeZone,
  NormalizedLandmark,
  createGazeStabilizer,
  estimateGazeZone,
} from '../hooks/useGazeEstimator'

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window')

// [GAZE] ScrollView horizontal para o seletor de zona alvo
const ScrollViewH = ({ children }: { children: React.ReactNode }) => (
  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
    {children}
  </ScrollView>
)

// [GAZE] Chave de storage para sessões (substitui PHOTOS_STORAGE_KEY)
const SESSIONS_STORAGE_KEY = '@gaze_tracker_sessions'

// ─────────────────────────────────────────────────────────────────────────────
// [GAZE] Tipos — substituem FaceData e SavedPhoto originais
// ─────────────────────────────────────────────────────────────────────────────

// [GAZE] Estado de detecção por frame — substitui FaceData
type GazeFrameData = {
  detected: boolean
  // posição normalizada da íris (0–1 no espaço do frame)
  leftIrisX?: number
  leftIrisY?: number
  rightIrisX?: number
  rightIrisY?: number
  // zona classificada (resultado de estimateGazeZone)
  zone: GazeZone
  irisNormX: number
  irisNormY: number
  confidence: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Modo de operação do app
// ─────────────────────────────────────────────────────────────────────────────

type AppMode =
  | 'camera'      // view principal com grade + câmera
  | 'sessions'    // log de sessões (substitui galeria)
  | 'calibration' // fluxo de calibração de zonas

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────

export default function Index() {
  // câmera frontal
  const device = useCameraDevice('front')
  const cameraRef = useRef<Camera>(null)

  const { hasPermission, requestPermission } = useCameraPermission()

  // [GAZE] Substitui faceData — agora inclui zona estimada
  const [gazeFrameData, setGazeFrameData] = useState<GazeFrameData>({
    detected: false,
    zone: 'unknown',
    irisNormX: 0.5,
    irisNormY: 0.5,
    confidence: 0,
  })

  // [GAZE] Thresholds ajustáveis para classificação (substitui offsets)
  const [thresholds, setThresholds] = useState<GazeThresholds>(DEFAULT_THRESHOLDS)

  // painel de controle de offsets visível
  // [GAZE] Reaproveitado — agora controla o painel de thresholds
  const [showControls, setShowControls] = useState(false)

  // [GAZE] Mostra dados numéricos brutos no overlay (modo debug)
  const [showDebug, setShowDebug] = useState(true)

  // [GAZE] Grade 3x3 visível
  const [showGrid, setShowGrid] = useState(true)

  // [GAZE] Modo do app
  const [appMode, setAppMode] = useState<AppMode>('camera')

  // [GAZE] Sessões de gaze (substitui photos)
  const [sessions, setSessions] = useState<GazeSession[]>([])

  // [GAZE] Sessão ativa (durante coleta)
  const [activeSession, setActiveSession] = useState<GazeSession | null>(null)

  // [GAZE] Zona alvo atual (durante coleta guiada)
  const [targetZone, setTargetZone] = useState<GazeZone | null>(null)

  // ─────────────────────────────────────────────────────────────────────────
  // [GAZE] Refs para valores lidos dentro do callback nativo
  //
  // PROBLEMA: useFaceLandmarkDetection registra o handleResults uma única vez
  // no lado nativo (no mount). Mesmo que o React recrie o callback com novos
  // valores de thresholds/activeSession/targetZone, o plugin nativo continua
  // chamando a versão original — stale closure.
  //
  // SOLUÇÃO: usar refs para qualquer valor que o callback precisa ler.
  // Refs são mutáveis e sempre apontam para o valor atual sem re-registro.
  // useState continua existindo só para disparar re-renders na UI.
  // ─────────────────────────────────────────────────────────────────────────
  const thresholdsRef = useRef<GazeThresholds>(DEFAULT_THRESHOLDS)
  const activeSessionRef = useRef<GazeSession | null>(null)
  const targetZoneRef = useRef<GazeZone | null>(null)

  // Mantém refs sincronizadas com o estado — toda vez que o estado muda,
  // a ref é atualizada imediatamente para o callback nativo ler o valor correto
  useEffect(() => { thresholdsRef.current = thresholds }, [thresholds])
  useEffect(() => { activeSessionRef.current = activeSession }, [activeSession])
  useEffect(() => { targetZoneRef.current = targetZone }, [targetZone])

  // ─────────────────────────────────────────────────────────────────────────
  // [GAZE] Estabilizador de zona — evita flickering entre frames
  // Criado uma vez com useRef para manter estado entre renders
  // ─────────────────────────────────────────────────────────────────────────
  const stabilizerRef = useRef(createGazeStabilizer(4))

  // ─────────────────────────────────────────────────────────────────────────
  // [GAZE] Callbacks para o useFaceLandmarkDetection
  //
  // Assinatura REAL do onResults (extraída do erro TypeScript do pacote):
  //   (result: FaceLandmarkDetectionResultBundle, viewSize: Dims, mirrored: boolean) => void
  //
  // FaceLandmarkDetectionResultBundle contém:
  //   bundle.results[0].faceLandmarks: NormalizedLandmark[][]
  //   — array de rostos, cada rosto é array de 478 pontos { x, y, z } normalizados 0–1
  //
  // Nota: NÃO é bundle.faceLandmarks diretamente — está dentro de bundle.results[0]
  //
  // IMPORTANTE: dependências removidas do useCallback ([]).
  // O callback lê thresholds/activeSession/targetZone via refs (acima),
  // não via closure — por isso não precisa ser recriado quando eles mudam.
  // ─────────────────────────────────────────────────────────────────────────

  // onResults: recebe o bundle completo + dimensões da view + flag de espelhamento
  const handleResults = useCallback(
    (bundle: any, _viewSize: any, _mirrored: boolean) => {
      // [GAZE] Callback chamado pelo MediaPipe a cada frame processado
      // bundle.results é array indexado por timestamp; em LIVE_STREAM usamos [0]
      const result = bundle?.results?.[0]

      if (!result?.faceLandmarks || result.faceLandmarks.length === 0) {
        // nenhum rosto detectado
        setGazeFrameData({
          detected: false,
          zone: 'unknown',
          irisNormX: 0.5,
          irisNormY: 0.5,
          confidence: 0,
        })
        return
      }

      // [GAZE] Pega os landmarks do primeiro rosto (array de 478 pontos normalizados)
      const landmarks: NormalizedLandmark[] = result.faceLandmarks[0]

      // [GAZE] Lê thresholds via ref — sempre o valor atual, mesmo que o estado
      // tenha mudado depois do mount (evita stale closure)
      const gazeResult = estimateGazeZone(landmarks, thresholdsRef.current)

      // [GAZE] Aplica estabilizador para evitar flickering
      const stableZone = stabilizerRef.current(gazeResult.zone)

      // [GAZE] Posições da íris em coordenadas de tela (para desenhar os dots)
      // MediaPipe retorna normalizado 0–1, multiplicamos pelas dimensões da tela
      const leftIrisX = landmarks[468] ? landmarks[468].x * SCREEN_WIDTH : undefined
      const leftIrisY = landmarks[468] ? landmarks[468].y * SCREEN_HEIGHT : undefined
      const rightIrisX = landmarks[473] ? landmarks[473].x * SCREEN_WIDTH : undefined
      const rightIrisY = landmarks[473] ? landmarks[473].y * SCREEN_HEIGHT : undefined

      setGazeFrameData({
        detected: true,
        leftIrisX,
        leftIrisY,
        rightIrisX,
        rightIrisY,
        zone: stableZone,
        irisNormX: gazeResult.irisNormX,
        irisNormY: gazeResult.irisNormY,
        confidence: gazeResult.confidence,
      })

      // [GAZE] Lê activeSession e targetZone via ref — mesmo motivo acima
      const currentSession = activeSessionRef.current
      const currentTarget = targetZoneRef.current

      // [GAZE] Se há uma sessão ativa com zona alvo definida, registra a amostra
      if (currentSession && currentTarget) {
        const sample: GazeSample = {
          timestamp: Date.now(),
          targetZone: currentTarget,
          detectedZone: stableZone,
          irisNormX: gazeResult.irisNormX,
          irisNormY: gazeResult.irisNormY,
          confidence: gazeResult.confidence,
          correct: stableZone === currentTarget,
        }
        setActiveSession(prev =>
          prev ? { ...prev, samples: [...prev.samples, sample] } : null
        )
      }
    },
    [] // sem dependências — lê tudo via refs
  )

  // onError: callback separado
  // [GAZE] DetectionError é o tipo próprio do pacote — não estende Error nativo,
  // por isso não tem a propriedade .name que Error exige
  const handleError = useCallback((error: DetectionError) => {
    console.error('[GazeTracker] Erro no FaceLandmarkDetection:', error)
    setGazeFrameData(prev => ({ ...prev, detected: false, zone: 'unknown', confidence: 0 }))
  }, [])

  // [GAZE] Hook do react-native-mediapipe v0.6.0
  // Substitui: useFaceDetector de react-native-vision-camera-face-detector
  //
  // Assinatura REAL (extraída do .d.ts do pacote):
  //   useFaceLandmarkDetection(onResults, onError, runningMode, model, options?)
  //
  // A documentação do site mostra um objeto { onResults, onError } mas o .d.ts
  // real do pacote usa argumentos posicionais separados nessa ordem específica.
  //
  // Retorna MediaPipeSolution com: { frameProcessor, cameraViewLayoutChangeHandler, ... }
  // O frameProcessor é passado diretamente para o <Camera> — não criamos o nosso.
  //
  // Modelo: baixe em https://storage.googleapis.com/mediapipe-models/face_landmarker/
  //         face_landmarker/float16/latest/face_landmarker.task
  //         e coloque em assets/models/face_landmarker.task
  const {
    frameProcessor,                 // passa direto para <Camera frameProcessor={...} />
    cameraViewLayoutChangeHandler,  // passa para onLayout do <Camera>
  } = useFaceLandmarkDetection(
    handleResults,                // (bundle, viewSize, mirrored) => void
    handleError,                  // (error: Error) => void
    RunningMode.LIVE_STREAM,
    'face_landmarker.task',       // nome do arquivo dentro de assets/models/
    {
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      delegate: Delegate.GPU,     // troque por Delegate.CPU se o app travar na init
      mirrorMode: 'mirror-front-only',
    }
  )

  // ─────────────────────────────────────────────────────────────────────────
  // Permissão de câmera
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!hasPermission) requestPermission()
  }, [hasPermission, requestPermission])

  // ─────────────────────────────────────────────────────────────────────────
  // carrega sessões salvas ao montar o componente
  // [GAZE] Reaproveitado de: carrega fotos salvas ao montar o componente
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const loadSessions = async () => {
      try {
        const stored = await AsyncStorage.getItem(SESSIONS_STORAGE_KEY)
        if (stored) {
          setSessions(JSON.parse(stored))
        }
      } catch (e) {
        console.error('Erro ao carregar sessões:', e)
      }
    }
    loadSessions()
  }, [])

  // ─────────────────────────────────────────────────────────────────────────
  // salva lista de sessões no AsyncStorage sempre que ela mudar
  // [GAZE] Reaproveitado de: salva lista de fotos no AsyncStorage
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const saveSessions = async () => {
      try {
        await AsyncStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions))
      } catch (e) {
        console.error('Erro ao salvar sessões:', e)
      }
    }
    saveSessions()
  }, [sessions])

  // ─────────────────────────────────────────────────────────────────────────
  // [GAZE] Processamento por frame
  // DIFERENÇA KEY em relação ao original e à versão anterior deste arquivo:
  //
  //   Original:  useFrameProcessor → detectFaces(frame) [MLKit, 5 landmarks]
  //   Anterior:  useFrameProcessor → faceLandmarker.detectFacesInFrame(frame) [ERRADO]
  //   Correto:   o useFaceLandmarkDetection já retorna frameProcessor pronto.
  //              NÃO usamos useFrameProcessor nem runAsync aqui.
  //              O frameProcessor desestruturado acima vai direto para <Camera>.
  // ─────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────
  // [GAZE] Controle de sessão de coleta
  // ─────────────────────────────────────────────────────────────────────────

  // [GAZE] Inicia uma nova sessão de coleta
  const startSession = (label?: string) => {
    const session: GazeSession = {
      id: Date.now().toString(),
      startedAt: Date.now(),
      samples: [],
      label: label ?? `Sessão ${new Date().toLocaleTimeString('pt-BR')}`,
    }
    setActiveSession(session)
  }

  // [GAZE] Finaliza a sessão ativa e persiste
  const endSession = () => {
    if (!activeSession) return
    const finished: GazeSession = {
      ...activeSession,
      endedAt: Date.now(),
    }
    setSessions(prev => [finished, ...prev])
    setActiveSession(null)
    setTargetZone(null)
  }

  // remove uma sessão individual do estado e do AsyncStorage
  // [GAZE] Reaproveitado de: deletePhoto
  const deleteSession = (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id))
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Guards de permissão e dispositivo
  // ─────────────────────────────────────────────────────────────────────────

  // tira snapshot da preview da camera e persiste os dados da foto
  const takePhoto = async () => {
    if (!cameraRef.current) return
    try {
      const photo = await cameraRef.current.takeSnapshot({
        quality: 90,
      })

      const uri = `file://${photo.path}`

      setPhotos(prev => [
        {
          uri,
          leftEye: faceData.leftEye,
          rightEye: faceData.rightEye,
          leftOffsetX,
          leftOffsetY,
          rightOffsetX,
          rightOffsetY,
          captureWidth: SCREEN_WIDTH,
          captureHeight: SCREEN_HEIGHT,
        },
        ...prev,
      ])
    } catch (e) {
      console.error('Erro ao tirar snapshot:', e)
    }
  }

  // remove uma foto individual do estado e do AsyncStorage
  const deletePhoto = (uri: string) => {
    setPhotos(prev => prev.filter(photo => photo.uri !== uri))
  }

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={{ color: 'white' }}>Permissão de câmera necessária</Text>
        <Button title="Permitir" onPress={requestPermission} />
      </View>
    )
  }

  if (device == null) {
    return (
      <View style={styles.center}>
        <Text style={{ color: 'white' }}>Buscando câmera...</Text>
      </View>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // [GAZE] Log de Sessões — substitui Galeria
  // ─────────────────────────────────────────────────────────────────────────
  if (appMode === 'sessions') {
    return (
      <GazeSessionLogger
        sessions={sessions}
        onDeleteSession={deleteSession}
        onBack={() => setAppMode('camera')}
      />
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // View principal: câmera + overlay de gaze
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* câmera frontal
          [GAZE] frameProcessor vem do useFaceLandmarkDetection, não criamos o nosso
          [GAZE] onLayout notifica o hook das dimensões reais da view (necessário para normalização)
          [GAZE] pixelFormat="rgb" é OBRIGATÓRIO para o MediaPipe no Android:
                 o VisionCamera entrega frames em YUV por padrão, mas o plugin nativo
                 do MediaPipe (imageToBitmap no Kotlin) espera RGBA/RGB.
                 Sem isso: "Buffer not large enough for pixels" → crash imediato.
                 No iOS o formato padrão já é compatível, mas rgb funciona nos dois. */}
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        pixelFormat="rgb"
        frameProcessor={frameProcessor}
        onLayout={cameraViewLayoutChangeHandler}
      />

      {/* [GAZE] Grade 3x3 + dots de íris — substitui os dois eyeDots originais */}
      <GazeOverlay
        gazeResult={
          gazeFrameData.detected
            ? {
                horizontal: gazeFrameData.irisNormX < 0.4 ? 'left' : gazeFrameData.irisNormX > 0.6 ? 'right' : 'center',
                vertical: gazeFrameData.irisNormY < 0.38 ? 'up' : gazeFrameData.irisNormY > 0.62 ? 'down' : 'middle',
                zone: gazeFrameData.zone,
                irisNormX: gazeFrameData.irisNormX,
                irisNormY: gazeFrameData.irisNormY,
                confidence: gazeFrameData.confidence,
                leftEyeNormX: gazeFrameData.irisNormX,
                leftEyeNormY: gazeFrameData.irisNormY,
                rightEyeNormX: gazeFrameData.irisNormX,
                rightEyeNormY: gazeFrameData.irisNormY,
              }
            : null
        }
        showGrid={showGrid}
        showDebug={showDebug}
        leftIrisScreenX={gazeFrameData.leftIrisX}
        leftIrisScreenY={gazeFrameData.leftIrisY}
        rightIrisScreenX={gazeFrameData.rightIrisX}
        rightIrisScreenY={gazeFrameData.rightIrisY}
      />

      {/* barra de ações superior — reaproveitada do original */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.topBtn}
          onPress={() => setAppMode('sessions')}>
          <Text style={styles.topBtnText}>
            {/* [GAZE] Substituiu: 🖼 Galeria */}
            📊 Sessões{sessions.length > 0 ? ` (${sessions.length})` : ''}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.topBtn}
          onPress={() => setShowGrid(v => !v)}>
          <Text style={styles.topBtnText}>
            {showGrid ? '⊞ Grade' : '⊟ Grade'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.topBtn}
          onPress={() => setShowDebug(v => !v)}>
          <Text style={styles.topBtnText}>🔬 Debug</Text>
        </TouchableOpacity>
      </View>

      {/* [GAZE] Controles de sessão — na parte inferior, substitui o botão shutter */}
      <View style={styles.bottomBar}>
        {activeSession ? (
          // sessão em andamento: mostra contador + seletor de zona alvo + botão encerrar
          <>
            {/* contador de amostras */}
            <View style={styles.sessionIndicator}>
              <Text style={styles.sessionIndicatorDot}>⏺</Text>
              <Text style={styles.sessionIndicatorText}>
                {activeSession.samples.length} amostras
              </Text>
            </View>

            {/* [GAZE] Seletor de zona alvo — define para qual zona o usuário deve olhar
                Sem isso targetZone fica null e nenhuma amostra é registrada */}
            <View style={styles.targetZonePicker}>
              <Text style={styles.targetZonePickerLabel}>Zona alvo:</Text>
              <ScrollViewH>
                {(['mid-left', 'mid-center', 'mid-right', 'top-center', 'bot-center'] as GazeZone[]).map(z => (
                  <TouchableOpacity
                    key={z}
                    style={[styles.zoneChip, targetZone === z && styles.zoneChipActive]}
                    onPress={() => setTargetZone(z)}>
                    <Text style={[styles.zoneChipText, targetZone === z && styles.zoneChipTextActive]}>
                      {z.replace('-', ' ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollViewH>
            </View>

            <TouchableOpacity
              style={[styles.sessionBtn, styles.sessionBtnEnd]}
              onPress={endSession}>
              <Text style={styles.sessionBtnText}>■ Encerrar</Text>
            </TouchableOpacity>
          </>
        ) : (
          // sem sessão ativa
          <TouchableOpacity
            style={[styles.sessionBtn, styles.sessionBtnStart]}
            onPress={() => startSession()}>
            <Text style={styles.sessionBtnText}>▶ Iniciar sessão</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* [GAZE] Indicador de zona alvo (durante coleta guiada) */}
      {targetZone && (
        <View style={styles.targetIndicator}>
          <Text style={styles.targetLabel}>OLHE PARA:</Text>
          <Text style={styles.targetZoneText}>{targetZone.replace('-', ' ').toUpperCase()}</Text>
        </View>
      )}

      {/* painel de ajuste de thresholds — reaproveitado do painel de offsets original */}
      {/* [GAZE] Substituiu: ajuste de offsets X/Y por ajuste de thresholds de zona */}
      {showControls && (
        <View style={styles.controlPanel}>
          <Text style={styles.panelTitle}>Thresholds de Zona</Text>

          <Text style={styles.panelSection}>← Horizontal (esq/dir) →</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Esq &lt; {thresholds.hLeft.toFixed(2)}</Text>
            <TouchableOpacity
              style={styles.adjBtn}
              onPress={() => setThresholds(t => ({ ...t, hLeft: Math.max(0.1, t.hLeft - 0.02) }))}>
              <Text style={styles.adjBtnText}>−</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.adjBtn}
              onPress={() => setThresholds(t => ({ ...t, hLeft: Math.min(0.49, t.hLeft + 0.02) }))}>
              <Text style={styles.adjBtnText}>+</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Dir &gt; {thresholds.hRight.toFixed(2)}</Text>
            <TouchableOpacity
              style={styles.adjBtn}
              onPress={() => setThresholds(t => ({ ...t, hRight: Math.max(0.51, t.hRight - 0.02) }))}>
              <Text style={styles.adjBtnText}>−</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.adjBtn}
              onPress={() => setThresholds(t => ({ ...t, hRight: Math.min(0.9, t.hRight + 0.02) }))}>
              <Text style={styles.adjBtnText}>+</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.panelSection}>↑ Vertical (cima/baixo) ↓</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Cima &lt; {thresholds.vUp.toFixed(2)}</Text>
            <TouchableOpacity
              style={styles.adjBtn}
              onPress={() => setThresholds(t => ({ ...t, vUp: Math.max(0.1, t.vUp - 0.02) }))}>
              <Text style={styles.adjBtnText}>−</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.adjBtn}
              onPress={() => setThresholds(t => ({ ...t, vUp: Math.min(0.49, t.vUp + 0.02) }))}>
              <Text style={styles.adjBtnText}>+</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Baixo &gt; {thresholds.vDown.toFixed(2)}</Text>
            <TouchableOpacity
              style={styles.adjBtn}
              onPress={() => setThresholds(t => ({ ...t, vDown: Math.max(0.51, t.vDown - 0.02) }))}>
              <Text style={styles.adjBtnText}>−</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.adjBtn}
              onPress={() => setThresholds(t => ({ ...t, vDown: Math.min(0.9, t.vDown + 0.02) }))}>
              <Text style={styles.adjBtnText}>+</Text>
            </TouchableOpacity>
          </View>

          {/* resetar offsets para os valores padrão */}
          {/* [GAZE] Reaproveitado — agora reseta thresholds */}
          <TouchableOpacity
            style={styles.resetBtn}
            onPress={() => setThresholds(DEFAULT_THRESHOLDS)}>
            <Text style={styles.resetBtnText}>↺ Resetar padrão</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* [GAZE] Botão flutuante para abrir painel de thresholds */}
      <TouchableOpacity
        style={styles.floatingConfigBtn}
        onPress={() => setShowControls(v => !v)}>
        <Text style={styles.floatingConfigBtnText}>⚙</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles — base mantida do original, novos marcados com [GAZE]
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111',
  },

  // barra superior com galeria e offsets
  topBar: {
    position: 'absolute',
    top: 55,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topBtn: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  topBtnText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
  },

  // [GAZE] Barra inferior de controle de sessão — substitui botão shutter
  bottomBar: {
    position: 'absolute',
    bottom: 38,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  sessionBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 30,
    borderWidth: 2,
  },
  sessionBtnStart: {
    backgroundColor: 'rgba(0, 200, 100, 0.25)',
    borderColor: 'rgba(0, 255, 120, 0.8)',
  },
  sessionBtnEnd: {
    backgroundColor: 'rgba(255, 60, 60, 0.25)',
    borderColor: 'rgba(255, 80, 80, 0.8)',
  },
  sessionBtnText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  sessionIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sessionIndicatorDot: {
    color: '#f55',
    fontSize: 16,
  },
  sessionIndicatorText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontFamily: 'monospace',
  },

  // [GAZE] Indicador de zona alvo
  targetIndicator: {
    position: 'absolute',
    top: 110,
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 220, 0, 0.2)',
    borderWidth: 2,
    borderColor: 'rgba(255, 220, 0, 0.8)',
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 16,
    alignItems: 'center',
  },
  targetLabel: {
    color: '#ffd700',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    fontFamily: 'monospace',
  },
  targetZoneText: {
    color: '#ffd700',
    fontSize: 20,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    marginTop: 4,
  },

  // [GAZE] Seletor de zona alvo inline na barra inferior
  targetZonePicker: {
    flex: 1,
    marginHorizontal: 8,
  },
  targetZonePickerLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontFamily: 'monospace',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  zoneChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  zoneChipActive: {
    borderColor: '#ffd700',
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
  },
  zoneChipText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  zoneChipTextActive: {
    color: '#ffd700',
    fontWeight: '700',
  },

  // painel flutuante de ajuste de offsets
  // [GAZE] Reaproveitado para thresholds
  controlPanel: {
    position: 'absolute',
    top: 110,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.85)',
    padding: 14,
    borderRadius: 16,
    minWidth: 220,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  panelTitle: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 10,
  },
  panelSection: {
    color: '#adf',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  label: {
    color: 'white',
    fontSize: 12,
    fontFamily: 'monospace',
    width: 80,
  },
  adjBtn: {
    backgroundColor: '#333',
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#555',
  },
  adjBtnText: {
    color: 'white',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: 'bold',
  },
  resetBtn: {
    marginTop: 12,
    backgroundColor: '#444',
    paddingVertical: 7,
    borderRadius: 10,
    alignItems: 'center',
  },
  resetBtnText: {
    color: '#ffd',
    fontSize: 12,
    fontWeight: '600',
  },

  // [GAZE] Botão flutuante de config
  floatingConfigBtn: {
    position: 'absolute',
    bottom: 44,
    right: 24,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  floatingConfigBtnText: {
    color: 'white',
    fontSize: 20,
  },
  // barra superior com galeria e offsets
  topBar: {
    position: 'absolute',
    top: 55,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topBtn: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  topBtnText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
  },
  // botão circular de foto
  shutterBtn: {
    position: 'absolute',
    bottom: 38,
    alignSelf: 'center',
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 4,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  shutterInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'white',
  },
  // painel flutuante de ajuste de offsets
  controlPanel: {
    position: 'absolute',
    top: 110,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.85)',
    padding: 14,
    borderRadius: 16,
    minWidth: 200,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  panelTitle: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 10,
  },
  panelSection: {
    color: '#adf',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  label: {
    color: 'white',
    fontSize: 12,
    fontFamily: 'monospace',
    width: 60,
  },
  adjBtn: {
    backgroundColor: '#333',
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#555',
  },
  adjBtnText: {
    color: 'white',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: 'bold',
  },
  resetBtn: {
    marginTop: 12,
    backgroundColor: '#444',
    paddingVertical: 7,
    borderRadius: 10,
    alignItems: 'center',
  },
  resetBtnText: {
    color: '#ffd',
    fontSize: 12,
    fontWeight: '600',
  },
  // galeria de fotos
  galleryHeader: {
    backgroundColor: '#111',
    paddingTop: 55,
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  backBtn: {
    marginRight: 16,
  },
  backBtnText: {
    color: '#4af',
    fontSize: 15,
    fontWeight: '600',
  },
  galleryTitle: {
    color: 'white',
    fontSize: 17,
    fontWeight: 'bold',
  },
  galleryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 4,
  },
  thumbnailWrapper: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    margin: 3,
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: 6,
    backgroundColor: '#222',
  },
  // botão de deletar foto individual
  deleteBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBtnText: {
    color: 'white',
    fontSize: 11,
    fontWeight: 'bold',
  },
  emptyText: {
    color: '#888',
    fontSize: 15,
  },
  viewerContainer: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  viewerEyeDot: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: 'white',
    zIndex: 30,
  },
  viewerCloseBtn: {
    position: 'absolute',
    top: 55,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  viewerCloseBtnText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
})
