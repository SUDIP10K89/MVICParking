import { StyleSheet, Text, View } from 'react-native';
import { mockSummary } from '../data/mockParkingData';

type ParkingOverviewProps = {
  summary: typeof mockSummary;
};

export default function ParkingOverview({ summary }: ParkingOverviewProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Parking Overview</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Total</Text>
        <Text style={styles.value}>{summary.totalSpots}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Available</Text>
        <Text style={styles.value}>{summary.availableSpots}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Occupied</Text>
        <Text style={styles.value}>{summary.occupiedSpots}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Reserved</Text>
        <Text style={styles.value}>{summary.reservedSpots}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    marginTop: 16,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  label: {
    color: '#475569',
    fontSize: 15,
  },
  value: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '600',
  },
});
