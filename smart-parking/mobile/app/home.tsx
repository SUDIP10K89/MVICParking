import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import ConnectionStatusCard from '../components/ConnectionStatusCard';
import ParkingOverview from '../components/ParkingOverview';
import ParkingSpotList from '../components/ParkingSpotList';
import { mockParkingData, mockSummary } from '../data/mockParkingData';
import { getHealthStatus } from '../services/api';

export default function HomeScreen() {
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
    <ScrollView contentContainerStyle={styles.container}>
      <ConnectionStatusCard isConnected={isConnected} isLoading={isLoading} />
      <ParkingOverview summary={mockSummary} />
      <ParkingSpotList spots={mockParkingData} />
      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
});
