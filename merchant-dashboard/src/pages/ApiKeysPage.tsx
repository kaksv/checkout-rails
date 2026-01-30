import React, { useState, useEffect } from 'react';
import { apiKeyApi } from '../services/api';
import { ApiKey, ApiKeyCreationResponse } from '../types';
import Button from '../components/ui/Button';
import CreateApiKeyModal from '../components/api-keys/CreateApiKeyModal';
import ApiKeyList from '../components/api-keys/ApiKeyList';
import toast from 'react-hot-toast';
import { KeyIcon, PlusIcon } from '@heroicons/react/24/outline';

const ApiKeysPage: React.FC = () => {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newApiKey, setNewApiKey] = useState<ApiKeyCreationResponse | null>(null);

  const loadApiKeys = async () => {
    try {
      setIsLoading(true);
      const { data } = await apiKeyApi.list();
      setApiKeys(data.apiKeys);
    } catch (error) {
      toast.error('Failed to load API keys');
      console.error('Load API keys error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateKey = async (label: string) => {
    try {
      const { data } = await apiKeyApi.create(label);
      setNewApiKey(data);
      await loadApiKeys();
      toast.success('API key created successfully!');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create API key');
    }
  };

  const handleRevokeKey = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) {
      return;
    }

    try {
      await apiKeyApi.revoke(id);
      await loadApiKeys();
      toast.success('API key revoked successfully');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to revoke API key');
    }
  };

  useEffect(() => {
    loadApiKeys();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <KeyIcon className="w-6 h-6 text-primary-600" />
            API Keys
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your API keys for server-side integrations
          </p>
        </div>
        <Button
          onClick={() => setIsModalOpen(true)}
          leftIcon={<PlusIcon className="w-4 h-4" />}
          size="md"
        >
          Create New Key
        </Button>
      </div>

      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-yellow-700">
              <strong>Security Notice:</strong> API keys should only be used on your server. 
              Never expose them in client-side code, mobile apps, or public repositories.
            </p>
          </div>
        </div>
      </div>

      <ApiKeyList
        apiKeys={apiKeys}
        isLoading={isLoading}
        onRevoke={handleRevokeKey}
      />

      <CreateApiKeyModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setNewApiKey(null);
        }}
        onCreate={handleCreateKey}
        newApiKey={newApiKey}
      />
    </div>
  );
};

export default ApiKeysPage;