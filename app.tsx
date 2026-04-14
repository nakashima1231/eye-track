import React, { useEffect } from 'react'
import { Button, StyleSheet, Text, View } from 'react-native'
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera'

export default function App() {
  const device = useCameraDevice('front')
  const { hasPermission, requestPermission } = useCameraPermission()

  useEffect(() => {
    if (!hasPermission) {
      requestPermission()
    }
  }, [hasPermission, requestPermission])

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text>Precisamos da permissão da câmera</Text>
        <Button title="Permitir câmera" onPress={requestPermission} />
      </View>
    )
  }

  if (device == null) {
    return (
      <View style={styles.center}>
        <Text>Câmera não encontrada</Text>
      </View>
    )
  }

  return <Camera style={StyleSheet.absoluteFill} device={device} isActive={true} />
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  }
})