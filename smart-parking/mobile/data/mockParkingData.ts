export type ParkingSpot = {
  id: string;
  label: string;
  status: 'available' | 'occupied' | 'reserved';
  floor: number;
  location: string;
};

export const mockParkingData: ParkingSpot[] = [
  { id: 'A-01', label: 'A-01', status: 'available', floor: 1, location: 'North Entrance' },
  { id: 'A-02', label: 'A-02', status: 'occupied', floor: 1, location: 'North Entrance' },
  { id: 'A-03', label: 'A-03', status: 'reserved', floor: 1, location: 'North Entrance' },
  { id: 'B-01', label: 'B-01', status: 'available', floor: 2, location: 'Main Plaza' },
  { id: 'B-02', label: 'B-02', status: 'available', floor: 2, location: 'Main Plaza' },
  { id: 'B-03', label: 'B-03', status: 'occupied', floor: 2, location: 'Main Plaza' },
];

export const mockSummary = {
  totalSpots: mockParkingData.length,
  availableSpots: mockParkingData.filter((spot) => spot.status === 'available').length,
  occupiedSpots: mockParkingData.filter((spot) => spot.status === 'occupied').length,
  reservedSpots: mockParkingData.filter((spot) => spot.status === 'reserved').length,
};
