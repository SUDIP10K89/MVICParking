import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { getHealthStatus } from '../services/api';

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const result = await getHealthStatus();
        setIsConnected(result.status === 'ok');
      } catch (error) {
        console.error('Health check failed', error);
        setIsConnected(false);
      } finally {
        setIsLoading(false);
      }
    };

    void checkHealth();
  }, []);

  return (
    <View style={styles.container}>
      {isLoading ? (
        <ActivityIndicator size="large" color="#2563eb" />
      ) : (
        <Text style={styles.statusText}>
          {isConnected ? 'Backend Connected ✅' : 'Backend Connection Failed ❌'}
        </Text>
      )}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  statusText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#0f172a',
    textAlign: 'center',
  },
});
