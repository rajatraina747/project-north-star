import { useEffect, useState } from 'react';
import { useAuthStore, getToken } from '../lib/auth';

/**
 * Hook to load images that require authentication.
 * Fetches the image with JWT token and converts to a blob URL.
 * Re-fetches when the auth token changes (e.g. after store hydration).
 */
export function useAuthenticatedImage(url: string | null): string | null {
  const token = useAuthStore((state) => state.token);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!url || !token) {
      setImageUrl(null);
      return;
    }

    let objectUrl: string | null = null;
    let cancelled = false;

    const loadImage = async () => {
      try {
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${getToken()}` },
        });

        if (cancelled) return;

        if (!response.ok) {
          console.error('Failed to load image:', response.status);
          return;
        }

        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      } catch (error) {
        if (!cancelled) console.error('Error loading image:', error);
      }
    };

    loadImage();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, token]);

  return imageUrl;
}
