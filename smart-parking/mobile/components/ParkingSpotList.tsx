import { StyleSheet, Text, View } from 'react-native';
import { mockParkingData, type ParkingSpot } from '../data/mockParkingData';

type ParkingSpotListProps = {
  spots: ParkingSpot[];
};

export default function ParkingSpotList({ spots }: ParkingSpotListProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Parking Spots</Text>
      {spots.map((spot) => (
        <View key={spot.id} style={styles.spotRow}>
          <View>
            <Text style={styles.spotLabel}>{spot.label}</Text>
            <Text style={styles.spotMeta}>{spot.location} • Floor {spot.floor}</Text>
          </View>
          <Text style={[styles.status, spot.status === 'available' ? styles.available : spot.status === 'occupied' ? styles.occupied : styles.reserved]}>
            {spot.status}
          </Text>
        </View>
      ))}
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
  spotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  spotLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
  },
  spotMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  status: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  available: {
    color: '#15803d',
  },
  occupied: {
    color: '#dc2626',
  },
  reserved: {
    color: '#d97706',
  },
});
