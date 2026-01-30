import React from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { auth } from '../../services/auth';
import toast from 'react-hot-toast';
import Button from '../ui/Button';
import { FcGoogle } from 'react-icons/fc';

const GoogleLoginButton: React.FC = () => {
  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      try {
        toast.loading('Authenticating...', { id: 'login' });
        await auth.login(tokenResponse.credential!);
        toast.success('Login successful!', { id: 'login' });
        window.location.href = '/dashboard';
      } catch (error: any) {
        toast.error(error.response?.data?.error || 'Authentication failed', { id: 'login' });
        console.error('Login error:', error);
      }
    },
    onError: () => {
      toast.error('Google login failed. Please try again.');
    },
    useOneTap: true,
  });

  return (
    <Button
      variant="outline"
      size="lg"
      onClick={() => login()}
      leftIcon={<FcGoogle className="w-5 h-5" />}
      className="w-full max-w-md"
    >
      Sign in with Google
    </Button>
  );
};

export default GoogleLoginButton;