import React, { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { ApiKeyCreationResponse } from '../../types';
import { CopyToClipboard } from '../ui/CopyToClipboard';
import { CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

interface CreateApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (label: string) => Promise<void>;
  newApiKey: ApiKeyCreationResponse | null;
}

const CreateApiKeyModal: React.FC<CreateApiKeyModalProps> = ({
  isOpen,
  onClose,
  onCreate,
  newApiKey,
}) => {
  const [label, setLabel] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [step, setStep] = useState<'form' | 'result'>('form');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim() || label.length < 3) return;
    
    setIsCreating(true);
    try {
      await onCreate(label.trim());
      setStep('result');
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    onClose();
    setStep('form');
    setLabel('');
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={step === 'form' ? 'Create API Key' : 'Your New API Key'}>
      {step === 'form' ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="label" className="block text-sm font-medium text-gray-700 mb-1">
              Key Label
            </label>
            <input
              type="text"
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Production Server, Test Environment, etc."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              maxLength={50}
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              Describe where this key will be used (e.g., "Production Server")
            </p>
          </div>

          <div className="bg-blue-50 p-3 rounded-lg">
            <div className="flex items-start">
              <div className="flex-shrink-0 mt-0.5">
                <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3 flex-1">
                <p className="text-sm text-blue-700">
                  <strong>Security Best Practice:</strong> Create separate keys for different environments (production, staging, development) to limit exposure if compromised.
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isCreating} disabled={label.length < 3}>
              Create Key
            </Button>
          </div>
        </form>
      ) : newApiKey ? (
        <div className="space-y-6">
          <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-r-lg">
            <div className="flex">
              <div className="flex-shrink-0">
                <ExclamationTriangleIcon className="h-5 w-5 text-red-400" />
              </div>
              <div className="ml-3">
                <p className="text-sm text-red-700">
                  <strong>SAVE THIS KEY NOW!</strong> For security reasons, this is the only time you'll see it. 
                  If you lose it, you'll need to create a new key.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Full API Key
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={newApiKey.fullKey}
                  readOnly
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg font-mono text-sm"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                  <CopyToClipboard text={newApiKey.fullKey} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Key Prefix
                </label>
                <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg font-mono text-sm">
                  {newApiKey.prefix}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Created
                </label>
                <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg">
                  {new Date(newApiKey.createdAt).toLocaleString()}
                </div>
              </div>
            </div>

            <div className="bg-green-50 p-4 rounded-lg">
              <div className="flex items-start">
                <div className="flex-shrink-0 mt-0.5">
                  <CheckCircleIcon className="h-5 w-5 text-green-400" />
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-green-800">Next Steps</h3>
                  <ul className="mt-2 text-sm text-green-700 space-y-1">
                    <li>✓ Copy this key to your server environment variable</li>
                    <li>✓ Use it in your backend integration (never in frontend code)</li>
                    <li>✓ Store it securely (e.g., .env file, secret manager)</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button onClick={handleClose} variant="primary">
              I've Saved My Key
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
};

export default CreateApiKeyModal;