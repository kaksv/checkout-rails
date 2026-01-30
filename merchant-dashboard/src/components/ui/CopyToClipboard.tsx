import React, { useState } from 'react';
import { CheckIcon, ClipboardIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

interface CopyToClipboardProps {
  text: string;
  size?: 'sm' | 'md';
}

export const CopyToClipboard: React.FC<CopyToClipboardProps> = ({ text, size = 'md' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Copied to clipboard!');
      
      // Reset after 2 seconds
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Failed to copy');
      console.error('Copy error:', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`
        p-1 rounded hover:bg-gray-100 transition-colors
        ${size === 'sm' ? 'p-0.5' : ''}
      `}
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <CheckIcon className={`w-4 h-4 text-green-500 ${size === 'sm' ? 'w-3 h-3' : ''}`} />
      ) : (
        <ClipboardIcon className={`w-4 h-4 text-gray-500 ${size === 'sm' ? 'w-3 h-3' : ''}`} />
      )}
    </button>
  );
};