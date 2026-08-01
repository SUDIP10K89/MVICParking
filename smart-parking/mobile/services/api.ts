import axios from 'axios';
import { Platform } from 'react-native';

const getBaseUrl = () => {
  const configuredUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

  if (configuredUrl) {
    if (configuredUrl.includes('127.0.0.1') || configuredUrl.includes('localhost')) {
      return Platform.OS === 'android' ? 'http://10.0.2.2:8000' : configuredUrl;
    }

    return configuredUrl;
  }

  return Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';
};

const api = axios.create({
  baseURL: getBaseUrl(),
  timeout: 10000,
});

export const getHealthStatus = async (): Promise<{ status: string }> => {
  const response = await api.get('/health');
  return response.data;
};
