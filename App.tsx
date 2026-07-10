import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions, Animated, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import { activateKeepAwake, deactivateKeepAwake } from 'expo-keep-awake';
import { getLocalIp, getApiBase } from './src/services/config';

type NewsData = {
  id: string; title: string; body: string | null; priority: number;
  startAt: string | null; endAt: string | null; isActive: boolean;
  updatedAt: string; type: 'strip' | 'card'; durationSec: number;
  opacity: number; backgroundColor: string | null; textColor: string | null;
};

const WS_PORT = 3003;
const HBEAT_MS = 3000;

function getDeviceId(): string {
  const chars = 'abcdef0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function luminance(hex: string): number {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

async function loadDeviceId(): Promise<string> {
  try { const stored = await AsyncStorage.getItem('deviceId'); if (stored) return stored; } catch {}
  const id = getDeviceId();
  try { await AsyncStorage.setItem('deviceId', id); } catch {}
  return id;
}

export default function App() {
  const [alert, setAlert] = useState<any>(null);
  const [news, setNews] = useState<NewsData | null>(null);
  const [clock, setClock] = useState(new Date());
  const [status, setStatus] = useState('Starting...');
  const pulse = useRef(new Animated.Value(1)).current;
  const deviceId = useRef('');
  const apiBaseRef = useRef('http://192.168.1.100:3000');
  const ipRef = useRef('0.0.0.0');
  const prevAlertId = useRef<string | null>(null);

  const speakAlert = (data: any) => {
    const text = [data.label, data.incidentLocation ? `in ${data.incidentLocation}` : '', data.message].filter(Boolean).join('. ');
    if (text) Speech.speak(text, { language: 'en', rate: 1.0, pitch: 1.0, volume: 1.0 });
  };

  useEffect(() => {
    let mounted = true;
    activateKeepAwake();
    (async () => {
      deviceId.current = await loadDeviceId();
      const ip = await getLocalIp();
      ipRef.current = ip;
      if (!mounted) return;
      setStatus(`Discovering backend... (IP: ${ip})`);
      try {
        apiBaseRef.current = await getApiBase();
        setStatus(`Backend: ${apiBaseRef.current}`);
      } catch (e: any) { if (mounted) setStatus(`Discovery failed: ${e.message}`); }
    })();

    const hbInterval = setInterval(async () => {
      const ip = await getLocalIp();
      ipRef.current = ip;
      try {
        const res = await fetch(`${apiBaseRef.current}/devices/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ip, port: WS_PORT, pcName: `TV-${deviceId.current}`,
            primaryMac: deviceId.current, appVersion: '1.0.0',
            osVersion: `${Platform.OS} ${Platform.Version}`, online: true, type: 'tv',
          }),
        });
        if (res.ok && mounted) {
          const data = await res.json();
          if (data.commands && Array.isArray(data.commands)) {
            for (const cmd of data.commands) {
              if (cmd.type === 'alert' && cmd.data) {
                if (prevAlertId.current !== cmd.data.id) {
                  prevAlertId.current = cmd.data.id;
                  speakAlert(cmd.data);
                }
                setAlert(cmd.data);
                setNews(null);
                Animated.sequence([
                  Animated.timing(pulse, { toValue: 1.03, duration: 300, useNativeDriver: true }),
                  Animated.timing(pulse, { toValue: 1, duration: 300, useNativeDriver: true }),
                ]).start();
              } else if (cmd.type === 'alert-clear' && cmd.data) {
                if (!alert || alert.id === cmd.data.alertId) {
                  setAlert(null);
                  prevAlertId.current = null;
                }
              } else if (cmd.type === 'it-news-update' && cmd.data && !alert) {
                setNews(cmd.data);
                setTimeout(() => { if (mounted) setNews(null); }, (cmd.data.durationSec || 10) * 1000);
              } else if (cmd.type === 'it-news-remove') {
                setNews((prev) => prev?.id === (cmd.data?.id || cmd.requestId) ? null : prev);
              }
            }
          }
        }
      } catch {}
    }, HBEAT_MS);

    const clockInterval = setInterval(() => { if (mounted) setClock(new Date()); }, 1000);
    return () => {
      mounted = false;
      deactivateKeepAwake();
      clearInterval(hbInterval);
      clearInterval(clockInterval);
    };
  }, []);

  if (alert) {
    const bgColor = alert.color || '#d32f2f';
    const light = luminance(bgColor) > 0.6;
    const tc = light ? '#000' : '#fff';
    const locationName = alert.incidentLocation || alert.codeLocation || alert.locationName || '';
    return (
      <View style={[styles.container, { backgroundColor: bgColor }]}>
        <StatusBar hidden />
        <Animated.View style={[styles.overlay, { transform: [{ scale: pulse }] }]}>
          <Text style={[styles.codeLabel, { color: tc }]}>{alert.label || 'ALERT'}</Text>
          <Text style={[styles.codeName, { color: tc }]}>{alert.code || ''}</Text>
          {locationName ? <Text style={[styles.location, { color: tc }]}>in {locationName}</Text> : null}
          {alert.message ? <Text style={[styles.message, { color: tc }]}>{alert.message}</Text> : null}
        </Animated.View>
      </View>
    );
  }

  const bgColor = '#1a1a2e';
  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <StatusBar hidden />
      {news ? (
        <View style={[styles.newsOverlay, { backgroundColor: news.backgroundColor || '#000000cc' }]}>
          <Text style={[styles.newsTitle, { color: news.textColor || '#fff' }]}>{news.title}</Text>
          {news.body ? <Text style={[styles.newsBody, { color: (news.textColor || '#fff') + 'cc' }]}>{news.body}</Text> : null}
        </View>
      ) : (
        <>
          <Text style={[styles.clock, { color: '#ffffff80' }]}>{clock.toLocaleTimeString()}</Text>
          <Text style={[styles.status, { color: '#ffffff40', marginTop: 16 }]}>{status}</Text>
        </>
      )}
    </View>
  );
}

const { width } = Dimensions.get('window');
const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  codeLabel: { fontSize: Math.min(72, width * 0.1), fontWeight: '800', textAlign: 'center' },
  codeName: { fontSize: Math.min(48, width * 0.07), fontWeight: '600', marginTop: 12, textAlign: 'center', opacity: 0.9 },
  location: { fontSize: Math.min(36, width * 0.05), marginTop: 8, fontWeight: '500', textAlign: 'center', opacity: 0.85 },
  message: { fontSize: Math.min(24, width * 0.035), marginTop: 16, textAlign: 'center', opacity: 0.75 },
  clock: { fontSize: Math.min(64, width * 0.09), fontWeight: '200' },
  status: { fontSize: 14, color: '#ffffff40', marginTop: 16 },
  newsOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 24, alignItems: 'center' },
  newsTitle: { fontSize: Math.min(32, width * 0.045), fontWeight: '700', textAlign: 'center' },
  newsBody: { fontSize: Math.min(20, width * 0.03), marginTop: 8, textAlign: 'center' },
});
