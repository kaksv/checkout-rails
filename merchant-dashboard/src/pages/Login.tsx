import React from 'react';
import { Link } from 'react-router-dom';
import GoogleLoginButton from '../components/auth/GoogleLoginButton';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';

const Login: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-indigo-50 p-4">
      <div className="max-w-md w-full space-y-8 bg-white p-10 rounded-2xl shadow-xl">
        <div className="text-center">
          <div className="flex justify-center">
            <ShieldCheckIcon className="h-16 w-16 text-primary-600" />
          </div>
          <h2 className="mt-6 text-3xl font-bold text-gray-900">Merchant Dashboard</h2>
          <p className="mt-2 text-sm text-gray-600">
            Securely manage your API keys and orders
          </p>
        </div>

        <div className="mt-8">
          <GoogleLoginButton />
          
          <div className="mt-6 text-center">
            <div className="text-sm text-gray-500">
              By signing in, you agree to our{' '}
              <a href="#" className="font-medium text-primary-600 hover:text-primary-500">
                Terms of Service
              </a>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-200">
          <div className="text-center">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Need an account?</h3>
            <p className="text-sm text-gray-600 mb-4">
              Use your university email to get started
            </p>
            <Link
              to="/request-access"
              className="font-medium text-primary-600 hover:text-primary-500"
            >
              Request access →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;