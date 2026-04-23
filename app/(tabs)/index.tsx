import AsyncStorage from '@react-native-async-storage/async-storage'
import React, { useEffect, useRef, useState } from 'react'
import { Button, Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Camera, runAsync, useCameraDevice, useCameraPermission, useFrameProcessor } from 'react-native-vision-camera'
import { useFaceDetector } from 'react-native-vision-camera-face-detector'
import { Worklets } from 'react-native-worklets-core'

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window')

const PHOTOS_STORAGE_KEY = '@face_tracker_photos'
const THUMB_SIZE = SCREEN_WIDTH / 3 - 6

type EyePoint = {
  x: number
  y: number
}

// dados do rosto
type FaceData = {
  detected: boolean
  leftEye?: EyePoint
  rightEye?: EyePoint
  bounds?: any
}

// foto salva com os pontos e tamanho da captura
type SavedPhoto = {
  uri: string
  leftEye?: EyePoint
  rightEye?: EyePoint
  leftOffsetX: number
  leftOffsetY: number
  rightOffsetX: number
  rightOffsetY: number
  captureWidth: number
  captureHeight: number
}

// Offsets padrão originais
const DEFAULT_LEFT_EYE_OFFSET_X = 10
const DEFAULT_LEFT_EYE_OFFSET_Y = -10
const DEFAULT_RIGHT_EYE_OFFSET_X = -25
const DEFAULT_RIGHT_EYE_OFFSET_Y = -10

const STEP = 5

export default function Index() {
  const device = useCameraDevice('front')
  const cameraRef = useRef<Camera>(null)

  const { hasPermission, requestPermission } = useCameraPermission()

  // coordenada do olho
  const [faceData, setFaceData] = useState<FaceData>({
    detected: false,
  })

  // offsets ajustáveis para os pontos dos olhos
  const [leftOffsetX, setLeftOffsetX] = useState(DEFAULT_LEFT_EYE_OFFSET_X)
  const [leftOffsetY, setLeftOffsetY] = useState(DEFAULT_LEFT_EYE_OFFSET_Y)
  const [rightOffsetX, setRightOffsetX] = useState(DEFAULT_RIGHT_EYE_OFFSET_X)
  const [rightOffsetY, setRightOffsetY] = useState(DEFAULT_RIGHT_EYE_OFFSET_Y)

  // painel de controle de offsets visível
  const [showControls, setShowControls] = useState(false)

  // fotos capturadas (dados persistidos no AsyncStorage)
  const [photos, setPhotos] = useState<SavedPhoto[]>([])
  const [showGallery, setShowGallery] = useState(false)

  // foto selecionada para visualizacao
  const [selectedPhoto, setSelectedPhoto] = useState<SavedPhoto | null>(null)

  // configuracao do detector
  const { detectFaces, stopListeners } = useFaceDetector({
    performanceMode: 'accurate',
    landmarkMode: 'all',
    classificationMode: 'all',
    cameraFacing: 'front',
    autoMode: true,
    windowWidth: SCREEN_WIDTH,
    windowHeight: SCREEN_HEIGHT,
  })

  useEffect(() => {
    if (!hasPermission) requestPermission()
  }, [hasPermission, requestPermission])

  useEffect(() => {
    return () => {
      stopListeners()
    }
  }, [stopListeners])

  // carrega fotos salvas ao montar o componente
  useEffect(() => {
    const loadPhotos = async () => {
      try {
        const stored = await AsyncStorage.getItem(PHOTOS_STORAGE_KEY)
        if (stored) {
          setPhotos(JSON.parse(stored))
        }
      } catch (e) {
        console.error('Erro ao carregar fotos:', e)
      }
    }
    loadPhotos()
  }, [])

  // salva lista de fotos no AsyncStorage sempre que ela mudar
  useEffect(() => {
    const savePhotos = async () => {
      try {
        await AsyncStorage.setItem(PHOTOS_STORAGE_KEY, JSON.stringify(photos))
      } catch (e) {
        console.error('Erro ao salvar fotos:', e)
      }
    }
    savePhotos()
  }, [photos])

  // recebe o rosto
  const handleDetectedFaces = Worklets.createRunOnJS((faces: any[]) => {
    if (faces.length > 0) {
      const face = faces[0]

      // landmarks do olho
      const leftEye = face.landmarks?.LEFT_EYE
      const rightEye = face.landmarks?.RIGHT_EYE

      setFaceData({
        detected: true,
        leftEye,
        rightEye,
        bounds: face.bounds,
      })
    } else {
      setFaceData({ detected: false })
    }
  })

  // rodacada frame da camera
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet'
    runAsync(frame, () => {
      'worklet'
      const faces = detectFaces(frame)
      handleDetectedFaces(faces)
    })
  }, [detectFaces, handleDetectedFaces])

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
        <Text>Permissão de câmera necessária</Text>
        <Button title="Permitir" onPress={requestPermission} />
      </View>
    )
  }

  if (device == null) {
    return (
      <View style={styles.center}>
        <Text>Buscando câmera...</Text>
      </View>
    )
  }

  // ── Galeria ──────────────────────────────────────────────────────────────
  if (showGallery) {
    const { Image } = require('expo-image')

    // visualizacao da foto dentro da galeria
    // visualizacao da foto dentro da galeria
    if (selectedPhoto) {
      return (
        <View style={styles.container}>
          <View style={styles.galleryHeader}>
            <TouchableOpacity onPress={() => setSelectedPhoto(null)} style={styles.backBtn}>
              <Text style={styles.backBtnText}>← Voltar</Text>
            </TouchableOpacity>
            <Text style={styles.galleryTitle}>Visualização</Text>
          </View>

          <View style={styles.viewerContainer}>
            <Image
              source={{ uri: selectedPhoto.uri }}
              style={styles.viewerImage}
              contentFit="contain"
            />

            {/* ponto azul no olho esquerdo */}
            {selectedPhoto.leftEye && (
              <View
                style={[
                  styles.viewerEyeDot,
                  {
                    backgroundColor: 'blue',
                    left:
                      ((selectedPhoto.leftEye.x + selectedPhoto.leftOffsetX) / selectedPhoto.captureWidth) * SCREEN_WIDTH,
                    top:
                      ((selectedPhoto.leftEye.y + selectedPhoto.leftOffsetY) / selectedPhoto.captureHeight) * SCREEN_HEIGHT,
                  },
                ]}
              />
            )}

            {/* ponto vermelho no olho direito */}
            {selectedPhoto.rightEye && (
              <View
                style={[
                  styles.viewerEyeDot,
                  {
                    backgroundColor: 'red',
                    left:
                      ((selectedPhoto.rightEye.x + selectedPhoto.rightOffsetX) / selectedPhoto.captureWidth) * SCREEN_WIDTH,
                    top:
                      ((selectedPhoto.rightEye.y + selectedPhoto.rightOffsetY) / selectedPhoto.captureHeight) * SCREEN_HEIGHT,
                  },
                ]}
              />
            )}

            {/* botão para fechar a foto e voltar para a galeria */}
            <TouchableOpacity
              style={styles.viewerCloseBtn}
              onPress={() => setSelectedPhoto(null)}>
              <Text style={styles.viewerCloseBtnText}>✕ Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      )
    }

    return (
      <View style={styles.container}>
        <View style={styles.galleryHeader}>
          <TouchableOpacity
            onPress={() => {
              setSelectedPhoto(null)
              setShowGallery(false)
            }}
            style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Câmera</Text>
          </TouchableOpacity>
          <Text style={styles.galleryTitle}>Fotos ({photos.length})</Text>
        </View>

        {photos.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>Nenhuma foto tirada ainda.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.galleryGrid}>
            {photos.map((photo, i) => {
              // calcula a escala da foto original para a miniatura
              const scaleX = THUMB_SIZE / photo.captureWidth
              const scaleY = THUMB_SIZE / photo.captureHeight

              // aplica escala nas coordenadas e offsets dos olhos
              const leftX = photo.leftEye ? (photo.leftEye.x + photo.leftOffsetX) * scaleX : 0
              const leftY = photo.leftEye ? (photo.leftEye.y + photo.leftOffsetY) * scaleY : 0
              const rightX = photo.rightEye ? (photo.rightEye.x + photo.rightOffsetX) * scaleX : 0
              const rightY = photo.rightEye ? (photo.rightEye.y + photo.rightOffsetY) * scaleY : 0

              return (
                <TouchableOpacity
                  key={i}
                  style={styles.thumbnailWrapper}
                  activeOpacity={0.9}
                  onPress={() => setSelectedPhoto(photo)}>
                  <Image
                    source={{ uri: photo.uri }}
                    style={styles.thumbnail}
                    contentFit="cover"
                  />

                  {/* ponto azul no olho esquerdo da foto */}
                  {photo.leftEye && (
                    <View
                      style={[
                        styles.savedEyeDot,
                        {
                          backgroundColor: 'blue',
                          left: leftX,
                          top: leftY,
                        },
                      ]}
                    />
                  )}

                  {/* ponto vermelho no olho direito da foto */}
                  {photo.rightEye && (
                    <View
                      style={[
                        styles.savedEyeDot,
                        {
                          backgroundColor: 'red',
                          left: rightX,
                          top: rightY,
                        },
                      ]}
                    />
                  )}

                  {/* botão de deletar foto */}
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => deletePhoto(photo.uri)}>
                    <Text style={styles.deleteBtnText}>✕</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        )}
      </View>
    )
  }

  return (
    <View style={styles.container}>
      { }
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        photo={true}
        frameProcessor={frameProcessor}
      />

      {/* ponto azul no olho esquerdo */}
      {faceData.leftEye && (
        <View
          style={[
            styles.eyeDot,
            {
              backgroundColor: 'blue',
              left: faceData.leftEye.x + leftOffsetX,
              top: faceData.leftEye.y + leftOffsetY,
            },
          ]}
        />
      )}

      {/* ponto azul no olho direito */}
      {faceData.rightEye && (
        <View
          style={[
            styles.eyeDot,
            {
              backgroundColor: 'red',
              left: faceData.rightEye.x + rightOffsetX,
              top: faceData.rightEye.y + rightOffsetY,
            },
          ]}
        />
      )}

      {/* informacoes do rastreamento */}
      <View style={styles.overlay}>
        {faceData.detected ? (
          <>
            <Text style={styles.statusText}>Rosto Detectado ✅</Text>
            <Text style={styles.text}>
              Esquerdo (azul): {faceData.leftEye?.x?.toFixed(0)}, {faceData.leftEye?.y?.toFixed(0)}
            </Text>
            <Text style={styles.text}>
              Direito (vermelho): {faceData.rightEye?.x?.toFixed(0)}, {faceData.rightEye?.y?.toFixed(0)}
            </Text>
          </>
        ) : (
          <Text style={styles.text}>Buscando rosto...</Text>
        )}
      </View>

      {/* barra de ações superior */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.topBtn} onPress={() => setShowGallery(true)}>
          <Text style={styles.topBtnText}>🖼 Galeria{photos.length > 0 ? ` (${photos.length})` : ''}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.topBtn} onPress={() => setShowControls(v => !v)}>
          <Text style={styles.topBtnText}>🎯 Configurar ponto</Text>
        </TouchableOpacity>
      </View>

      {/* botão de tirar foto */}
      <TouchableOpacity style={styles.shutterBtn} onPress={takePhoto}>
        <View style={styles.shutterInner} />
      </TouchableOpacity>

      {/* painel de ajuste de offsets */}
      {showControls && (
        <View style={styles.controlPanel}>
          <Text style={styles.panelTitle}>Ajuste de Offsets (±{STEP}px)</Text>

          {/* olho esquerdo */}
          <Text style={styles.panelSection}>👁 Esquerdo (azul)</Text>
          <View style={styles.row}>
            <Text style={styles.label}>X: {leftOffsetX > 0 ? '+' : ''}{leftOffsetX}</Text>
            <TouchableOpacity style={styles.adjBtn} onPress={() => setLeftOffsetX(v => v - STEP)}>
              <Text style={styles.adjBtnText}>−</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.adjBtn} onPress={() => setLeftOffsetX(v => v + STEP)}>
              <Text style={styles.adjBtnText}>+</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Y: {leftOffsetY > 0 ? '+' : ''}{leftOffsetY}</Text>
            <TouchableOpacity style={styles.adjBtn} onPress={() => setLeftOffsetY(v => v - STEP)}>
              <Text style={styles.adjBtnText}>−</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.adjBtn} onPress={() => setLeftOffsetY(v => v + STEP)}>
              <Text style={styles.adjBtnText}>+</Text>
            </TouchableOpacity>
          </View>

          {/* olho direito */}
          <Text style={styles.panelSection}>👁 Direito (vermelho)</Text>
          <View style={styles.row}>
            <Text style={styles.label}>X: {rightOffsetX > 0 ? '+' : ''}{rightOffsetX}</Text>
            <TouchableOpacity style={styles.adjBtn} onPress={() => setRightOffsetX(v => v - STEP)}>
              <Text style={styles.adjBtnText}>−</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.adjBtn} onPress={() => setRightOffsetX(v => v + STEP)}>
              <Text style={styles.adjBtnText}>+</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Y: {rightOffsetY > 0 ? '+' : ''}{rightOffsetY}</Text>
            <TouchableOpacity style={styles.adjBtn} onPress={() => setRightOffsetY(v => v - STEP)}>
              <Text style={styles.adjBtnText}>−</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.adjBtn} onPress={() => setRightOffsetY(v => v + STEP)}>
              <Text style={styles.adjBtnText}>+</Text>
            </TouchableOpacity>
          </View>

          {/* resetar offsets para os valores padrão */}
          <TouchableOpacity
            style={styles.resetBtn}
            onPress={() => {
              setLeftOffsetX(DEFAULT_LEFT_EYE_OFFSET_X)
              setLeftOffsetY(DEFAULT_LEFT_EYE_OFFSET_Y)
              setRightOffsetX(DEFAULT_RIGHT_EYE_OFFSET_X)
              setRightOffsetY(DEFAULT_RIGHT_EYE_OFFSET_Y)
            }}>
            <Text style={styles.resetBtnText}>↺ Resetar padrão</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

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
  eyeDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ff0000',
    borderWidth: 2,
    borderColor: 'white',
    zIndex: 999,
  },
  savedEyeDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'white',
    zIndex: 20,
  },
  overlay: {
    position: 'absolute',
    bottom: 110,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 15,
    borderRadius: 15,
    width: '80%',
  },
  statusText: {
    color: '#00ff00',
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 5,
  },
  text: {
    color: 'white',
    fontSize: 14,
    fontFamily: 'monospace',
    textAlign: 'center',
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
