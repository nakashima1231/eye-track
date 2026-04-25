// components/GazeSessionLogger.tsx
// [GAZE] Substitui a galeria de fotos por um log de sessões de teste de gaze
// Registra: zona alvo, zona detectada, acurácia por zona, timestamp

import React from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { GazeZone } from '../hooks/useGazeEstimator'

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

// [GAZE] Uma amostra individual de coleta
export type GazeSample = {
  timestamp: number
  targetZone: GazeZone    // zona que o usuário deveria estar olhando
  detectedZone: GazeZone  // zona que o sistema detectou
  irisNormX: number
  irisNormY: number
  confidence: number
  correct: boolean        // targetZone === detectedZone
}

// [GAZE] Uma sessão completa (ex: "teste olho esquerdo-direito-centro")
export type GazeSession = {
  id: string
  startedAt: number
  endedAt?: number
  samples: GazeSample[]
  label?: string          // ex: "Teste H 3-zonas", "Grade 3x3 - Participante A"
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  sessions: GazeSession[]
  onDeleteSession: (id: string) => void
  onBack: () => void
}

export default function GazeSessionLogger({ sessions, onDeleteSession, onBack }: Props) {
  // Calcula acurácia de uma sessão
  const getAccuracy = (session: GazeSession) => {
    if (session.samples.length === 0) return 0
    const correct = session.samples.filter(s => s.correct).length
    return (correct / session.samples.length) * 100
  }

  // Agrupa acertos por zona alvo (para ver em quais zonas o sistema erra mais)
  const getZoneBreakdown = (session: GazeSession) => {
    const zones: Record<string, { correct: number; total: number }> = {}
    for (const sample of session.samples) {
      const z = sample.targetZone
      if (!zones[z]) zones[z] = { correct: 0, total: 0 }
      zones[z].total++
      if (sample.correct) zones[z].correct++
    }
    return zones
  }

  return (
    <View style={styles.container}>
      {/* cabeçalho */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Câmera</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Sessões de Gaze ({sessions.length})</Text>
      </View>

      {sessions.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>👁</Text>
          <Text style={styles.emptyText}>Nenhuma sessão registrada.</Text>
          <Text style={styles.emptySubtext}>
            Inicie um teste de gaze para ver os dados aqui.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {sessions.map((session) => {
            const acc = getAccuracy(session)
            const breakdown = getZoneBreakdown(session)
            const duration = session.endedAt
              ? ((session.endedAt - session.startedAt) / 1000).toFixed(1)
              : '—'

            return (
              <View key={session.id} style={styles.card}>
                {/* header do card */}
                <View style={styles.cardHeader}>
                  <Text style={styles.cardLabel}>{session.label ?? `Sessão ${session.id.slice(-4)}`}</Text>
                  <TouchableOpacity
                    onPress={() => onDeleteSession(session.id)}
                    style={styles.deleteBtn}>
                    <Text style={styles.deleteBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>

                {/* métricas gerais */}
                <View style={styles.metricsRow}>
                  <View style={styles.metric}>
                    <Text style={styles.metricValue}>{acc.toFixed(0)}%</Text>
                    <Text style={styles.metricLabel}>acurácia</Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricValue}>{session.samples.length}</Text>
                    <Text style={styles.metricLabel}>amostras</Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricValue}>{duration}s</Text>
                    <Text style={styles.metricLabel}>duração</Text>
                  </View>
                </View>

                {/* breakdown por zona */}
                <Text style={styles.breakdownTitle}>Acurácia por zona:</Text>
                <View style={styles.breakdownGrid}>
                  {Object.entries(breakdown).map(([zone, data]) => {
                    const zoneAcc = data.total > 0 ? (data.correct / data.total) * 100 : 0
                    const color = zoneAcc >= 70 ? '#0f9' : zoneAcc >= 40 ? '#fa0' : '#f55'
                    return (
                      <View key={zone} style={styles.breakdownItem}>
                        <Text style={[styles.breakdownAcc, { color }]}>
                          {zoneAcc.toFixed(0)}%
                        </Text>
                        <Text style={styles.breakdownZone}>{zone}</Text>
                      </View>
                    )
                  })}
                </View>

                {/* data */}
                <Text style={styles.timestamp}>
                  {new Date(session.startedAt).toLocaleString('pt-BR')}
                </Text>
              </View>
            )
          })}
        </ScrollView>
      )}
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    paddingTop: 55,
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  backBtn: { marginRight: 16 },
  backBtnText: { color: '#4af', fontSize: 15, fontWeight: '600' },
  title: { color: 'white', fontSize: 17, fontWeight: 'bold' },

  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  emptyIcon: { fontSize: 48 },
  emptyText: { color: '#888', fontSize: 16, fontWeight: '600' },
  emptySubtext: { color: '#555', fontSize: 13, textAlign: 'center', paddingHorizontal: 40 },

  list: { padding: 12, gap: 12 },

  card: {
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardLabel: { color: 'white', fontSize: 15, fontWeight: '700' },
  deleteBtn: {
    backgroundColor: '#2a2a2a',
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBtnText: { color: '#888', fontSize: 12, fontWeight: 'bold' },

  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  metric: { alignItems: 'center' },
  metricValue: { color: '#0f9', fontSize: 22, fontWeight: 'bold', fontFamily: 'monospace' },
  metricLabel: { color: '#666', fontSize: 11, marginTop: 2 },

  breakdownTitle: { color: '#666', fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  breakdownGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  breakdownItem: { alignItems: 'center', minWidth: 60 },
  breakdownAcc: { fontSize: 16, fontWeight: 'bold', fontFamily: 'monospace' },
  breakdownZone: { color: '#555', fontSize: 10, marginTop: 2 },

  timestamp: { color: '#444', fontSize: 11, fontFamily: 'monospace' },
})
