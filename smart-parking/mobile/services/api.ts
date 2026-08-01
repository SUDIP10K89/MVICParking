import axios from 'axios';

const api = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8000',
  timeout: 10000,
});

export const getHealthStatus = async (): Promise<{ status: string }> => {
  const response = await api.get('/health');
  return response.data;
};
