import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

type ConnectionStatusCardProps = {
  isConnected: boolean;
  isLoading: boolean;
};

export default function ConnectionStatusCard({ isConnected, isLoading }: ConnectionStatusCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>Backend status</Text>
      {isLoading ? (
        <ActivityIndicator size="large" color="#2563eb" />
      ) : (
        <Text style={[styles.statusText, isConnected ? styles.connected : styles.disconnected]}>
          {isConnected ? 'Backend Connected ✅' : 'Backend Connection Failed ❌'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 360,
    padding: 24,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  label: {
    marginBottom: 12,
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  statusText: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  connected: {
    color: '#15803d',
  },
  disconnected: {
    color: '#dc2626',
  },
});
