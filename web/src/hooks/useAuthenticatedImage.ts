import { useEffect, useState } from 'react';
import { getToken } from '../lib/auth';

/**
 * Hook to load images that require authentication
 * Fetches the image with JWT token and converts to a blob URL
 */
export function useAuthenticatedImage(url: string | null): string | null {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setImageUrl(null);
      return;
    }

    let objectUrl: string | null = null;

    const loadImage = async () => {
      try {
        const token = getToken();
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) {
          console.error('Failed to load image:', response.status);
          return;
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      } catch (error) {
        console.error('Error loading image:', error);
      }
    };

    loadImage();

    // Cleanup: revoke the blob URL when component unmounts or URL changes
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [url]);

  return imageUrl;
}
