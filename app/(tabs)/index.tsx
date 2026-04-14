import React, { useEffect, useState } from 'react'
import { Button, Dimensions, StyleSheet, Text, View } from 'react-native'
import { Camera, runAsync, useCameraDevice, useCameraPermission, useFrameProcessor } from 'react-native-vision-camera'
import { useFaceDetector } from 'react-native-vision-camera-face-detector'
import { Worklets } from 'react-native-worklets-core'

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window')

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

export default function Index() {
  const device = useCameraDevice('front')

  const { hasPermission, requestPermission } = useCameraPermission()

  // coordenada do olho
  const [faceData, setFaceData] = useState<FaceData>({
    detected: false,
  })

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

  return (
    <View style={styles.container}>
      {}
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        frameProcessor={frameProcessor}
      />

      {/* ponto azul no olho esquerdo */}
      {faceData.leftEye && (
        <View
          style={[
            styles.eyeDot,
            {
              backgroundColor: 'blue',
              left: faceData.leftEye.x + 10,
              top: faceData.leftEye.y - 10,
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
              left: faceData.rightEye.x - 25,
              top: faceData.rightEye.y - 10,
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
              Esquerdo (vermelho): {faceData.leftEye?.x?.toFixed(0)}, {faceData.leftEye?.y?.toFixed(0)}
            </Text>
            <Text style={styles.text}>
              Direito (azul): {faceData.rightEye?.x?.toFixed(0)}, {faceData.rightEye?.y?.toFixed(0)}
            </Text>
          </>
        ) : (
          <Text style={styles.text}>Buscando rosto...</Text>
        )}
      </View>
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
  overlay: {
    position: 'absolute',
    bottom: 40,
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
})
