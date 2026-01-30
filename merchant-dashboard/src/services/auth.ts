import { Session } from '../types';
import { authApi } from './api';

let currentUser: Session | null = null;
let sessionChecked = false;

export const auth = {
  // Initialize session on app load
  init: async (): Promise<boolean> => {
    if (sessionChecked) return currentUser !== null;
    
    try {
      const { data } = await authApi.getSession();
      currentUser = data;
      sessionChecked = true;
      return true;
    } catch (error) {
      currentUser = null;
      sessionChecked = true;
      return false;
    }
  },
  
  // Get current user (cached)
  getCurrentUser: (): Session | null => {
    return currentUser;
  },
  
  // Login with Google credential
  login: async (credential: string): Promise<Session> => {
    const { data } = await authApi.googleLogin(credential);
    currentUser = data;
    sessionChecked = true;
    return data;
  },
  
  // Logout
  logout: async (): Promise<void> => {
    await authApi.logout();
    currentUser = null;
    sessionChecked = true;
    window.location.href = '/login';
  },
  
  // Check if user is authenticated
  isAuthenticated: (): boolean => {
    return currentUser !== null;
  },
  
  // Force refresh session
  refresh: async (): Promise<boolean> => {
    sessionChecked = false;
    return auth.init();
  },
};